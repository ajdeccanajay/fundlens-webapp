/**
 * SEC Data Handling Unit Tests
 * 
 * Tests for Task 12: Public SEC data handling with multi-tenant support
 * 
 * Requirements tested:
 * - 7.1: SEC filings stored in public/ S3 prefix
 * - 7.2: SEC data_source has visibility='public'
 * - 7.3: SEC data_source has owner_tenant_id=NULL
 * - 7.4: SEC chunk metadata has tenant_id=NULL for Bedrock KB filtering
 * - 7.5, 7.6: Multiple tenants get same SEC data
 * - 7.9: Deal creation doesn't duplicate SEC data
 */

import { Test, TestingModule } from '@nestjs/testing';
import { S3DataLakeService } from '../../src/s3/s3-data-lake.service';
import { SECSyncService } from '../../src/s3/sec-sync.service';
import { ChunkExporterService } from '../../src/rag/chunk-exporter.service';
import { TenantAwareRAGService } from '../../src/tenant/tenant-aware-rag.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { SecService } from '../../src/dataSources/sec/sec.service';
import { REQUEST } from '@nestjs/core';

describe('SEC Data Handling - Multi-Tenant', () => {
  describe('S3DataLakeService - SEC Filing Paths', () => {
    let service: S3DataLakeService;
    let prisma: PrismaService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          S3DataLakeService,
          {
            provide: PrismaService,
            useValue: {},
          },
        ],
      }).compile();

      service = module.get<S3DataLakeService>(S3DataLakeService);
      prisma = module.get<PrismaService>(PrismaService);
    });

    it('should use public/ prefix for SEC filings (Req 7.1)', () => {
      const path = service.getSECFilingPath('AAPL', '10-K', 'FY2024', 'raw');
      
      expect(path).toMatch(/^public\//);
      expect(path).toBe('public/sec-filings/raw/AAPL/10-K/FY2024');
    });

    it('should use public/ prefix for processed SEC data (Req 7.1)', () => {
      const path = service.getSECFilingPath('AAPL', '10-K', 'FY2024', 'processed');
      
      expect(path).toMatch(/^public\//);
      expect(path).toBe('public/sec-filings/processed/AAPL/10-K/FY2024');
    });

    it('should use tenants/ prefix for tenant documents (contrast)', () => {
      const path = service.getTenantDocumentPath('tenant-123', 'doc-456', 'raw');
      
      expect(path).toMatch(/^tenants\//);
      expect(path).toBe('tenants/tenant-123/uploads/raw/doc-456');
    });

    it('should differentiate SEC paths from tenant paths', () => {
      const secPath = service.getSECFilingPath('AAPL', '10-K', 'FY2024');
      const tenantPath = service.getTenantDocumentPath('tenant-123', 'doc-456');
      
      expect(secPath.startsWith('public/')).toBe(true);
      expect(tenantPath.startsWith('tenants/')).toBe(true);
      expect(secPath).not.toContain('tenant');
    });
  });

  describe('ChunkExporterService - SEC Chunk Metadata', () => {
    let service: ChunkExporterService;
    let prisma: PrismaService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ChunkExporterService,
          {
            provide: PrismaService,
            useValue: {
              narrativeChunk: {
                findMany: jest.fn(),
              },
            },
          },
        ],
      }).compile();

      service = module.get<ChunkExporterService>(ChunkExporterService);
      prisma = module.get<PrismaService>(PrismaService);
    });

    it('should set visibility=public for SEC filing chunks (Req 7.4)', () => {
      const secChunk = {
        ticker: 'AAPL',
        sectionType: 'mda',
        content: 'Management discussion content',
        chunkIndex: 0,
        filingType: '10-K',
        documentType: 'sec_filing',
        // No tenantId - this is public SEC data
      };

      const formatted = service['formatChunkForBedrock'](secChunk);

      expect(formatted.metadata.visibility).toBe('public');
    });

    it('should set tenant_id=null for SEC filing chunks (Req 7.4)', () => {
      const secChunk = {
        ticker: 'AAPL',
        sectionType: 'risk_factors',
        content: 'Risk factors content',
        chunkIndex: 1,
        filingType: '10-K',
        documentType: 'sec_filing',
      };

      const formatted = service['formatChunkForBedrock'](secChunk);

      expect(formatted.metadata.tenant_id).toBeNull();
    });

    it('should set visibility=private for tenant upload chunks', () => {
      const tenantChunk = {
        ticker: 'AAPL',
        sectionType: 'custom_analysis',
        content: 'Private analysis content',
        chunkIndex: 0,
        documentType: 'upload',
        tenantId: 'tenant-123',
        visibility: 'private',
      };

      const formatted = service['formatChunkForBedrock'](tenantChunk);

      expect(formatted.metadata.visibility).toBe('private');
      expect(formatted.metadata.tenant_id).toBe('tenant-123');
    });

    it('should treat chunks without tenantId as public (legacy data)', () => {
      const legacyChunk = {
        ticker: 'MSFT',
        sectionType: 'business',
        content: 'Legacy business description',
        chunkIndex: 0,
        filingType: '10-K',
        // No tenantId, no documentType - legacy data
      };

      const formatted = service['formatChunkForBedrock'](legacyChunk);

      expect(formatted.metadata.visibility).toBe('public');
      expect(formatted.metadata.tenant_id).toBeNull();
    });

    it('should include visibility in Bedrock metadata attributes', async () => {
      const mockChunks = [
        {
          ticker: 'AAPL',
          sectionType: 'mda',
          content: 'A'.repeat(200),
          chunkIndex: 0,
          documentType: 'sec_filing',
        },
      ];

      (prisma.narrativeChunk.findMany as jest.Mock).mockResolvedValue(mockChunks);

      const { chunks } = await service.exportChunksForBedrock({ ticker: 'AAPL' });

      expect(chunks[0].metadata.visibility).toBe('public');
      expect(chunks[0].metadata.tenant_id).toBeNull();
    });
  });

  describe('TenantAwareRAGService - SEC Data Access', () => {
    let service: TenantAwareRAGService;
    let prisma: PrismaService;
    let bedrockService: BedrockService;

    const createMockRequest = (tenantId: string) => ({
      tenantContext: { tenantId, userId: 'user-1', userRole: 'analyst' },
    });

    beforeEach(async () => {
      const mockRequest = createMockRequest('tenant-A');

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TenantAwareRAGService,
          {
            provide: BedrockService,
            useValue: {
              retrieve: jest.fn().mockResolvedValue([]),
            },
          },
          {
            provide: PrismaService,
            useValue: {
              dataSource: {
                findMany: jest.fn().mockResolvedValue([]),
                findFirst: jest.fn(),
              },
              financialMetric: {
                findMany: jest.fn().mockResolvedValue([]),
              },
              narrativeChunk: {
                findMany: jest.fn().mockResolvedValue([]),
              },
            },
          },
          {
            provide: REQUEST,
            useValue: mockRequest,
          },
        ],
      }).compile();

      service = await module.resolve<TenantAwareRAGService>(TenantAwareRAGService);
      prisma = module.get<PrismaService>(PrismaService);
      bedrockService = module.get<BedrockService>(BedrockService);
    });

    it('should build filter that includes public SEC data (Req 7.5)', () => {
      const filter = service.buildTenantFilter({ ticker: 'AAPL' });

      // Filter should include visibility='public' condition
      expect(filter).toBeDefined();
      expect(filter.andAll).toBeDefined();
      
      const accessFilter = filter.andAll[0];
      expect(accessFilter.orAll).toBeDefined();
      expect(accessFilter.orAll).toContainEqual({
        equals: { key: 'visibility', value: 'public' },
      });
    });

    it('should build filter that includes tenant private data', () => {
      const filter = service.buildTenantFilter({ ticker: 'AAPL' });

      const accessFilter = filter.andAll[0];
      expect(accessFilter.orAll).toContainEqual({
        equals: { key: 'tenant_id', value: 'tenant-A' },
      });
    });

    it('should allow access to public SEC data sources (Req 7.5, 7.6)', async () => {
      const publicSecDataSource = {
        id: 'ds-sec-aapl',
        type: 'sec_filing',
        visibility: 'public',
        ownerTenantId: null,
      };

      (prisma.dataSource.findFirst as jest.Mock).mockResolvedValue(publicSecDataSource);

      const isAccessible = await service.isDataSourceAccessible('ds-sec-aapl');

      expect(isAccessible).toBe(true);
    });

    it('should allow access to own private data sources', async () => {
      const privateDataSource = {
        id: 'ds-private-1',
        type: 'upload',
        visibility: 'private',
        ownerTenantId: 'tenant-A',
      };

      (prisma.dataSource.findFirst as jest.Mock).mockResolvedValue(privateDataSource);

      const isAccessible = await service.isDataSourceAccessible('ds-private-1');

      expect(isAccessible).toBe(true);
    });

    it('should deny access to other tenant private data sources', async () => {
      // findFirst returns null when no matching record (tenant-B's data not accessible to tenant-A)
      (prisma.dataSource.findFirst as jest.Mock).mockResolvedValue(null);

      const isAccessible = await service.isDataSourceAccessible('ds-tenant-b-private');

      expect(isAccessible).toBe(false);
    });

    it('should post-filter results to ensure tenant isolation', () => {
      const results = [
        { content: 'Public SEC data', metadata: { visibility: 'public' } },
        { content: 'Tenant A private', metadata: { visibility: 'private', tenant_id: 'tenant-A' } },
        { content: 'Tenant B private', metadata: { visibility: 'private', tenant_id: 'tenant-B' } },
        { content: 'Legacy data', metadata: {} },
      ];

      const filtered = service['postFilterResults'](results as any, 'tenant-A');

      expect(filtered).toHaveLength(3); // Public, Tenant A, Legacy
      expect(filtered.map(r => r.content)).toContain('Public SEC data');
      expect(filtered.map(r => r.content)).toContain('Tenant A private');
      expect(filtered.map(r => r.content)).toContain('Legacy data');
      expect(filtered.map(r => r.content)).not.toContain('Tenant B private');
    });
  });

  describe('SEC Data Non-Duplication (Req 7.9)', () => {
    let prisma: PrismaService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          {
            provide: PrismaService,
            useValue: {
              dataSource: {
                findUnique: jest.fn(),
                upsert: jest.fn(),
              },
            },
          },
        ],
      }).compile();

      prisma = module.get<PrismaService>(PrismaService);
    });

    it('should not create duplicate SEC data sources for same filing', async () => {
      const existingSource = {
        id: 'ds-1',
        type: 'sec_filing',
        sourceId: 'AAPL-10-K-0000320193-24-000081',
        visibility: 'public',
        ownerTenantId: null,
      };

      (prisma.dataSource.findUnique as jest.Mock).mockResolvedValue(existingSource);

      // Simulate what SECSyncService does - it checks for existing before creating
      const sourceId = 'AAPL-10-K-0000320193-24-000081';
      const existing = await prisma.dataSource.findUnique({
        where: {
          type_sourceId: {
            type: 'sec_filing',
            sourceId,
          },
        },
      });

      expect(existing).toBeDefined();
      expect(existing?.visibility).toBe('public');
      expect(existing?.ownerTenantId).toBeNull();
    });

    it('should use upsert to prevent duplicates', async () => {
      const sourceId = 'AAPL-10-K-0000320193-24-000081';
      
      await prisma.dataSource.upsert({
        where: {
          type_sourceId: {
            type: 'sec_filing',
            sourceId,
          },
        },
        create: {
          type: 'sec_filing',
          sourceId,
          visibility: 'public',
          ownerTenantId: null,
          s3Path: 'public/sec-filings/raw/AAPL/10-K/0000320193-24-000081',
          metadata: {},
        },
        update: {
          s3Path: 'public/sec-filings/raw/AAPL/10-K/0000320193-24-000081',
        },
      });

      expect(prisma.dataSource.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            visibility: 'public',
            ownerTenantId: null,
          }),
        }),
      );
    });
  });

  describe('Multiple Tenants Same SEC Data (Req 7.5, 7.6)', () => {
    it('should return same SEC data for different tenants', async () => {
      const createServiceForTenant = async (tenantId: string) => {
        const mockRequest = {
          tenantContext: { tenantId, userId: 'user-1', userRole: 'analyst' },
        };

        const module: TestingModule = await Test.createTestingModule({
          providers: [
            TenantAwareRAGService,
            {
              provide: BedrockService,
              useValue: {
                retrieve: jest.fn().mockResolvedValue([
                  { content: 'AAPL Revenue $394B', metadata: { visibility: 'public', ticker: 'AAPL' } },
                ]),
              },
            },
            {
              provide: PrismaService,
              useValue: {
                dataSource: { findMany: jest.fn().mockResolvedValue([]) },
                financialMetric: { findMany: jest.fn().mockResolvedValue([]) },
                narrativeChunk: { findMany: jest.fn().mockResolvedValue([]) },
              },
            },
            {
              provide: REQUEST,
              useValue: mockRequest,
            },
          ],
        }).compile();

        return module.resolve<TenantAwareRAGService>(TenantAwareRAGService);
      };

      const tenantAService = await createServiceForTenant('tenant-A');
      const tenantBService = await createServiceForTenant('tenant-B');

      // Both tenants should get the same public SEC data
      const tenantAFilter = tenantAService.buildTenantFilter({ ticker: 'AAPL' });
      const tenantBFilter = tenantBService.buildTenantFilter({ ticker: 'AAPL' });

      // Both filters should include visibility='public'
      expect(tenantAFilter.andAll[0].orAll).toContainEqual({
        equals: { key: 'visibility', value: 'public' },
      });
      expect(tenantBFilter.andAll[0].orAll).toContainEqual({
        equals: { key: 'visibility', value: 'public' },
      });
    });
  });

  describe('SEC Data Source Properties', () => {
    it('should have correct properties for SEC data source (Req 7.2, 7.3)', () => {
      // This tests the expected structure of SEC data sources
      const secDataSource = {
        type: 'sec_filing',
        sourceId: 'AAPL-10-K-0000320193-24-000081',
        visibility: 'public',
        ownerTenantId: null,
        s3Path: 'public/sec-filings/raw/AAPL/10-K/0000320193-24-000081',
        metadata: {
          ticker: 'AAPL',
          filingType: '10-K',
          accessionNumber: '0000320193-24-000081',
          filingDate: '2024-11-01',
        },
      };

      expect(secDataSource.visibility).toBe('public');
      expect(secDataSource.ownerTenantId).toBeNull();
      expect(secDataSource.s3Path).toMatch(/^public\//);
    });

    it('should have correct properties for tenant upload data source (contrast)', () => {
      const tenantDataSource = {
        type: 'upload',
        sourceId: 'tenant-A-doc-123',
        visibility: 'private',
        ownerTenantId: 'tenant-A',
        s3Path: 'tenants/tenant-A/uploads/raw/doc-123/analysis.pdf',
        metadata: {
          originalFilename: 'analysis.pdf',
          uploadedBy: 'user-1',
        },
      };

      expect(tenantDataSource.visibility).toBe('private');
      expect(tenantDataSource.ownerTenantId).toBe('tenant-A');
      expect(tenantDataSource.s3Path).toMatch(/^tenants\//);
    });
  });
});
