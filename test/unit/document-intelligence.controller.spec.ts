/**
 * DocumentIntelligenceController — Unit Tests
 * Tests Session 1 API endpoints: Spec §10.1
 *
 * Coverage:
 *   - POST /api/documents/upload-url
 *   - POST /api/documents/:id/upload-complete
 *   - GET  /api/documents/:id/status
 *   - GET  /api/documents/deal/:dealId
 *   - Tenant isolation
 *   - File size validation
 */

import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentIntelligenceController } from '../../src/documents/document-intelligence.controller';
import { DocumentIntelligenceService } from '../../src/documents/document-intelligence.service';
import { S3Service } from '../../src/services/s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantGuard } from '../../src/tenant/tenant.guard';

describe('DocumentIntelligenceController', () => {
  let controller: DocumentIntelligenceController;
  let service: jest.Mocked<DocumentIntelligenceService>;
  let s3: jest.Mocked<S3Service>;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDealId = '22222222-2222-2222-2222-222222222222';
  const mockDocId = '33333333-3333-3333-3333-333333333333';

  const mockRequest = (tenantId?: string) => ({
    tenantId: tenantId || mockTenantId,
    headers: { 'x-tenant-id': tenantId || mockTenantId },
  } as any);

  beforeEach(async () => {
    const mockService = {
      createUploadUrl: jest.fn(),
      getDocumentStatus: jest.fn(),
      processInstantIntelligence: jest.fn(),
      prisma: {
        $queryRaw: jest.fn(),
      },
    };

    const mockS3 = {
      fileExists: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DocumentIntelligenceController],
      providers: [
        { provide: DocumentIntelligenceService, useValue: mockService },
        { provide: S3Service, useValue: mockS3 },
        { provide: Reflector, useValue: new Reflector() },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PrismaService, useValue: { $queryRaw: jest.fn() } },
      ],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(DocumentIntelligenceController);
    service = module.get(DocumentIntelligenceService);
    s3 = module.get(S3Service);
  });

  // ─── POST /api/documents/upload-url ────────────────────────────

  describe('getUploadUrl', () => {
    it('should return uploadUrl and documentId', async () => {
      service.createUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.presigned.url/upload',
        documentId: mockDocId,
      });

      const result = await controller.getUploadUrl(
        {
          fileName: 'report.pdf',
          fileType: 'application/pdf',
          fileSize: 1024000,
          dealId: mockDealId,
          uploadSource: 'chat',
        },
        mockRequest(),
      );

      expect(result.uploadUrl).toBe('https://s3.presigned.url/upload');
      expect(result.documentId).toBe(mockDocId);
    });

    it('should pass tenant ID from request context', async () => {
      service.createUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.presigned.url/upload',
        documentId: mockDocId,
      });

      await controller.getUploadUrl(
        {
          fileName: 'report.pdf',
          fileType: 'application/pdf',
          fileSize: 1024000,
          dealId: mockDealId,
          uploadSource: 'chat',
        },
        mockRequest(),
      );

      expect(service.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: mockTenantId }),
      );
    });

    it('should reject chat uploads over 50 MB', async () => {
      await expect(
        controller.getUploadUrl(
          {
            fileName: 'huge.pdf',
            fileType: 'application/pdf',
            fileSize: 60 * 1024 * 1024, // 60 MB
            dealId: mockDealId,
            uploadSource: 'chat',
          },
          mockRequest(),
        ),
      ).rejects.toThrow(HttpException);
    });

    it('should allow deal-library uploads over 50 MB', async () => {
      service.createUploadUrl.mockResolvedValue({
        uploadUrl: 'https://s3.presigned.url/upload',
        documentId: mockDocId,
      });

      // deal-library uploads don't have the 50MB restriction
      const result = await controller.getUploadUrl(
        {
          fileName: 'huge.pdf',
          fileType: 'application/pdf',
          fileSize: 60 * 1024 * 1024,
          dealId: mockDealId,
          uploadSource: 'deal-library',
        },
        mockRequest(),
      );

      expect(result.documentId).toBe(mockDocId);
    });

    it('should throw 401 when tenant context is missing', async () => {
      const noTenantReq = { headers: {} } as any;

      await expect(
        controller.getUploadUrl(
          {
            fileName: 'report.pdf',
            fileType: 'application/pdf',
            fileSize: 1024000,
            dealId: mockDealId,
            uploadSource: 'chat',
          },
          noTenantReq,
        ),
      ).rejects.toThrow(HttpException);
    });
  });

  // ─── POST /api/documents/:id/upload-complete ───────────────────

  describe('uploadComplete', () => {
    it('should trigger instant intelligence and return result', async () => {
      service.getDocumentStatus.mockResolvedValue({
        documentId: mockDocId,
        status: 'uploading',
        processingMode: null,
        documentType: null,
        chunkCount: null,
        metricCount: null,
        error: null,
        updatedAt: new Date(),
      });

      (service as any).prisma.$queryRaw.mockResolvedValue([{
        s3_key: 'raw-uploads/test.pdf',
        file_type: 'application/pdf',
        file_name: 'test.pdf',
        tenant_id: mockTenantId,
        deal_id: mockDealId,
      }]);

      const mockIntel = {
        documentId: mockDocId,
        documentType: 'sell-side-report',
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        summary: 'Goldman Sachs report',
        headlineMetrics: [{ metric_key: 'price_target', raw_value: '$275', numeric_value: 275, period: 'FY2025E', is_estimate: true }],
        suggestedQuestions: ['What is the price target?'],
        fileName: 'test.pdf',
      };
      service.processInstantIntelligence.mockResolvedValue(mockIntel);

      const result = await controller.uploadComplete(mockDocId, mockRequest());

      expect(result).toEqual(mockIntel);
      expect(service.processInstantIntelligence).toHaveBeenCalledWith(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );
    });

    it('should return 404 when document not found', async () => {
      service.getDocumentStatus.mockResolvedValue(null);

      await expect(
        controller.uploadComplete('nonexistent', mockRequest()),
      ).rejects.toThrow(HttpException);
    });

    it('should return 404 when document belongs to different tenant', async () => {
      service.getDocumentStatus.mockResolvedValue({
        documentId: mockDocId,
        status: 'uploading',
        processingMode: null,
        documentType: null,
        chunkCount: null,
        metricCount: null,
        error: null,
        updatedAt: new Date(),
      });

      // Return empty — tenant mismatch
      (service as any).prisma.$queryRaw.mockResolvedValue([]);

      await expect(
        controller.uploadComplete(mockDocId, mockRequest()),
      ).rejects.toThrow(HttpException);
    });
  });

  // ─── GET /api/documents/:id/status ─────────────────────────────

  describe('getStatus', () => {
    it('should return document status', async () => {
      const mockStatus = {
        documentId: mockDocId,
        status: 'queryable' as const,
        processingMode: 'long-context-fallback',
        documentType: 'sell-side-report',
        chunkCount: null,
        metricCount: 2,
        error: null,
        updatedAt: new Date(),
      };
      service.getDocumentStatus.mockResolvedValue(mockStatus);

      const result = await controller.getStatus(mockDocId);

      expect(result).toEqual(mockStatus);
    });

    it('should return 404 when document not found', async () => {
      service.getDocumentStatus.mockResolvedValue(null);

      await expect(controller.getStatus('nonexistent')).rejects.toThrow(HttpException);
    });
  });

  // ─── GET /api/documents/deal/:dealId ───────────────────────────

  describe('listByDeal', () => {
    it('should return documents for a deal with tenant isolation', async () => {
      const mockDocs = [
        { document_id: mockDocId, file_name: 'report.pdf', status: 'queryable' },
      ];
      (service as any).prisma.$queryRaw.mockResolvedValue(mockDocs);

      const result = await controller.listByDeal(mockDealId, mockRequest());

      expect(result).toEqual(mockDocs);
    });

    it('should return empty array when no documents exist', async () => {
      (service as any).prisma.$queryRaw.mockResolvedValue([]);

      const result = await controller.listByDeal(mockDealId, mockRequest());

      expect(result).toEqual([]);
    });
  });
});
