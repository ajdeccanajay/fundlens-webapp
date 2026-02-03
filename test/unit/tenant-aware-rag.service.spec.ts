/**
 * Unit Tests for TenantAwareRAGService
 * 
 * Tests tenant isolation for RAG operations:
 * - Tenant filter construction includes public + owned data
 * - Metrics filtering by accessible data sources
 * - Narrative retrieval with tenant filtering
 * - Cross-tenant data isolation
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';
import { TenantAwareRAGService } from '../../src/tenant/tenant-aware-rag.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TENANT_CONTEXT_KEY, TenantContext } from '../../src/tenant/tenant-context';

describe('TenantAwareRAGService', () => {
  let service: TenantAwareRAGService;
  let mockBedrockService: any;
  let mockPrismaService: any;
  let mockRequest: any;

  const tenantA: TenantContext = {
    tenantId: 'tenant-a-id',
    tenantSlug: 'tenant-a',
    tenantTier: 'pro',
    userId: 'user-a-id',
    userEmail: 'user-a@example.com',
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

  const tenantB: TenantContext = {
    tenantId: 'tenant-b-id',
    tenantSlug: 'tenant-b',
    tenantTier: 'enterprise',
    userId: 'user-b-id',
    userEmail: 'user-b@example.com',
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
      [TENANT_CONTEXT_KEY]: tenantA,
    };

    mockBedrockService = {
      retrieve: jest.fn(),
      generate: jest.fn(),
    };

    mockPrismaService = {
      dataSource: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      financialMetric: {
        findMany: jest.fn(),
      },
      narrativeChunk: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantAwareRAGService,
        { provide: BedrockService, useValue: mockBedrockService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: REQUEST, useValue: mockRequest },
      ],
    }).compile();

    service = await module.resolve<TenantAwareRAGService>(TenantAwareRAGService);
  });

  describe('buildTenantFilter', () => {
    it('should include visibility=public OR tenant_id=current in filter (Req 5.1, 5.4)', () => {
      const filter = service.buildTenantFilter();

      expect(filter).toEqual({
        orAll: [
          { equals: { key: 'visibility', value: 'public' } },
          { equals: { key: 'tenant_id', value: 'tenant-a-id' } },
        ],
      });
    });

    it('should combine tenant filter with ticker filter', () => {
      const filter = service.buildTenantFilter({ ticker: 'AAPL' });

      expect(filter).toEqual({
        andAll: [
          {
            orAll: [
              { equals: { key: 'visibility', value: 'public' } },
              { equals: { key: 'tenant_id', value: 'tenant-a-id' } },
            ],
          },
          { equals: { key: 'ticker', value: 'AAPL' } },
        ],
      });
    });

    it('should combine tenant filter with section type filter', () => {
      const filter = service.buildTenantFilter({ sectionType: 'risk_factors' });

      expect(filter).toEqual({
        andAll: [
          {
            orAll: [
              { equals: { key: 'visibility', value: 'public' } },
              { equals: { key: 'tenant_id', value: 'tenant-a-id' } },
            ],
          },
          { equals: { key: 'section_type', value: 'risk_factors' } },
        ],
      });
    });

    it('should combine tenant filter with filing type filter', () => {
      const filter = service.buildTenantFilter({ filingType: '10-K' });

      expect(filter).toEqual({
        andAll: [
          {
            orAll: [
              { equals: { key: 'visibility', value: 'public' } },
              { equals: { key: 'tenant_id', value: 'tenant-a-id' } },
            ],
          },
          { equals: { key: 'filing_type', value: '10-K' } },
        ],
      });
    });

    it('should combine all filters together', () => {
      const filter = service.buildTenantFilter({
        ticker: 'MSFT',
        sectionType: 'mda',
        filingType: '10-Q',
        fiscalPeriod: 'Q3-2024',
      });

      expect(filter.andAll).toHaveLength(5);
      expect(filter.andAll[0].orAll).toBeDefined(); // Tenant filter
      expect(filter.andAll[1]).toEqual({ equals: { key: 'ticker', value: 'MSFT' } });
      expect(filter.andAll[2]).toEqual({ equals: { key: 'section_type', value: 'mda' } });
      expect(filter.andAll[3]).toEqual({ equals: { key: 'filing_type', value: '10-Q' } });
      expect(filter.andAll[4]).toEqual({ equals: { key: 'fiscal_period', value: 'Q3-2024' } });
    });

    it('should use different tenant ID for different tenant context', async () => {
      // Create service with tenant B context
      mockRequest[TENANT_CONTEXT_KEY] = tenantB;
      
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TenantAwareRAGService,
          { provide: BedrockService, useValue: mockBedrockService },
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: REQUEST, useValue: mockRequest },
        ],
      }).compile();

      const serviceTenantB = await module.resolve<TenantAwareRAGService>(TenantAwareRAGService);
      const filter = serviceTenantB.buildTenantFilter();

      expect(filter.orAll[1]).toEqual({
        equals: { key: 'tenant_id', value: 'tenant-b-id' },
      });
    });

    it('should use default tenant when no context provided', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = undefined;
      
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          TenantAwareRAGService,
          { provide: BedrockService, useValue: mockBedrockService },
          { provide: PrismaService, useValue: mockPrismaService },
          { provide: REQUEST, useValue: mockRequest },
        ],
      }).compile();

      const serviceNoContext = await module.resolve<TenantAwareRAGService>(TenantAwareRAGService);
      const filter = serviceNoContext.buildTenantFilter();

      expect(filter.orAll[1]).toEqual({
        equals: { key: 'tenant_id', value: 'default-tenant' },
      });
    });
  });

  describe('getAccessibleMetrics', () => {
    it('should filter metrics by accessible data sources (Req 5.2)', async () => {
      const accessibleSources = [
        { id: 'public-source-1' },
        { id: 'tenant-a-source-1' },
      ];

      const mockMetrics = [
        { id: 'metric-1', ticker: 'AAPL', normalizedMetric: 'revenue', dataSourceId: 'public-source-1' },
        { id: 'metric-2', ticker: 'AAPL', normalizedMetric: 'net_income', dataSourceId: 'tenant-a-source-1' },
      ];

      mockPrismaService.dataSource.findMany.mockResolvedValue(accessibleSources);
      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.getAccessibleMetrics('AAPL');

      expect(mockPrismaService.dataSource.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { visibility: 'public' },
            { ownerTenantId: 'tenant-a-id' },
            {
              accessGrants: {
                some: {
                  tenantId: 'tenant-a-id',
                  OR: [
                    { expiresAt: null },
                    { expiresAt: { gt: expect.any(Date) } },
                  ],
                },
              },
            },
          ],
        },
        select: { id: true },
      });

      expect(mockPrismaService.financialMetric.findMany).toHaveBeenCalledWith({
        where: {
          ticker: 'AAPL',
          OR: [
            { dataSourceId: { in: ['public-source-1', 'tenant-a-source-1'] } },
            { dataSourceId: null },
          ],
        },
        orderBy: [
          { fiscalPeriod: 'desc' },
          { normalizedMetric: 'asc' },
        ],
      });

      expect(result).toEqual(mockMetrics);
    });

    it('should filter by fiscal period when provided', async () => {
      mockPrismaService.dataSource.findMany.mockResolvedValue([{ id: 'source-1' }]);
      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);

      await service.getAccessibleMetrics('AAPL', 'FY2024');

      expect(mockPrismaService.financialMetric.findMany).toHaveBeenCalledWith({
        where: {
          ticker: 'AAPL',
          fiscalPeriod: 'FY2024',
          OR: expect.any(Array),
        },
        orderBy: expect.any(Array),
      });
    });

    it('should uppercase ticker symbol', async () => {
      mockPrismaService.dataSource.findMany.mockResolvedValue([]);
      mockPrismaService.financialMetric.findMany.mockResolvedValue([]);

      await service.getAccessibleMetrics('aapl');

      expect(mockPrismaService.financialMetric.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ticker: 'AAPL',
          }),
        }),
      );
    });
  });

  describe('getAccessibleNarrativeChunks', () => {
    it('should filter chunks by accessible data sources (Req 5.3)', async () => {
      const accessibleSources = [{ id: 'source-1' }, { id: 'source-2' }];
      const mockChunks = [
        { id: 'chunk-1', ticker: 'AAPL', content: 'Risk factor 1' },
        { id: 'chunk-2', ticker: 'AAPL', content: 'Risk factor 2' },
      ];

      mockPrismaService.dataSource.findMany.mockResolvedValue(accessibleSources);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue(mockChunks);

      const result = await service.getAccessibleNarrativeChunks('AAPL', {
        sectionType: 'risk_factors',
      });

      expect(mockPrismaService.narrativeChunk.findMany).toHaveBeenCalledWith({
        where: {
          ticker: 'AAPL',
          sectionType: 'risk_factors',
          OR: [
            { dataSourceId: { in: ['source-1', 'source-2'] } },
            { dataSourceId: null },
          ],
        },
        take: 20,
        orderBy: { chunkIndex: 'asc' },
      });

      expect(result).toEqual(mockChunks);
    });

    it('should respect limit parameter', async () => {
      mockPrismaService.dataSource.findMany.mockResolvedValue([]);
      mockPrismaService.narrativeChunk.findMany.mockResolvedValue([]);

      await service.getAccessibleNarrativeChunks('AAPL', { limit: 5 });

      expect(mockPrismaService.narrativeChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 5,
        }),
      );
    });
  });

  describe('retrieveNarratives', () => {
    it('should call BedrockService with tenant filter (Req 5.5)', async () => {
      const mockResults = [
        {
          content: 'Public SEC data',
          score: 0.95,
          metadata: { ticker: 'AAPL', sectionType: 'mda', filingType: '10-K', visibility: 'public' },
          source: { location: 's3://bucket/public/aapl.txt', type: 'S3' },
        },
        {
          content: 'Tenant A private data',
          score: 0.90,
          metadata: { ticker: 'AAPL', sectionType: 'mda', filingType: '10-K', tenant_id: 'tenant-a-id' },
          source: { location: 's3://bucket/tenants/tenant-a-id/doc.txt', type: 'S3' },
        },
      ];

      mockBedrockService.retrieve.mockResolvedValue(mockResults);

      const result = await service.retrieveNarratives('Apple revenue', { ticker: 'AAPL' });

      expect(mockBedrockService.retrieve).toHaveBeenCalledWith(
        'Apple revenue',
        { ticker: 'AAPL' },
        10,
      );

      expect(result).toHaveLength(2);
    });

    it('should filter out other tenants private data (Req 5.5)', async () => {
      const mockResults = [
        {
          content: 'Public SEC data',
          score: 0.95,
          metadata: { ticker: 'AAPL', sectionType: 'mda', filingType: '10-K', visibility: 'public' },
          source: { location: 's3://bucket/public/aapl.txt', type: 'S3' },
        },
        {
          content: 'Tenant B private data - should be filtered',
          score: 0.90,
          metadata: { ticker: 'AAPL', sectionType: 'mda', filingType: '10-K', tenant_id: 'tenant-b-id', visibility: 'private' },
          source: { location: 's3://bucket/tenants/tenant-b-id/doc.txt', type: 'S3' },
        },
        {
          content: 'Tenant A private data - should be included',
          score: 0.85,
          metadata: { ticker: 'AAPL', sectionType: 'mda', filingType: '10-K', tenant_id: 'tenant-a-id' },
          source: { location: 's3://bucket/tenants/tenant-a-id/doc.txt', type: 'S3' },
        },
      ];

      mockBedrockService.retrieve.mockResolvedValue(mockResults);

      const result = await service.retrieveNarratives('Apple revenue');

      // Should filter out tenant B's private data
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Public SEC data');
      expect(result[1].content).toBe('Tenant A private data - should be included');
    });

    it('should include legacy data without visibility/tenant_id', async () => {
      const mockResults = [
        {
          content: 'Legacy data without metadata',
          score: 0.95,
          metadata: { ticker: 'AAPL', sectionType: 'mda', filingType: '10-K' }, // No visibility or tenant_id
          source: { location: 's3://bucket/legacy/aapl.txt', type: 'S3' },
        },
      ];

      mockBedrockService.retrieve.mockResolvedValue(mockResults);

      const result = await service.retrieveNarratives('Apple revenue');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Legacy data without metadata');
    });
  });

  describe('query', () => {
    it('should combine narratives and metrics with tenant filtering', async () => {
      const mockNarratives = [
        {
          content: 'Apple revenue discussion',
          score: 0.95,
          metadata: { ticker: 'AAPL', sectionType: 'mda', filingType: '10-K', visibility: 'public' },
          source: { location: 's3://bucket/public/aapl.txt', type: 'S3' },
        },
      ];

      const mockMetrics = [
        { id: 'metric-1', ticker: 'AAPL', normalizedMetric: 'revenue', value: 100000000 },
      ];

      mockBedrockService.retrieve.mockResolvedValue(mockNarratives);
      mockPrismaService.dataSource.findMany.mockResolvedValue([{ id: 'source-1' }]);
      mockPrismaService.financialMetric.findMany.mockResolvedValue(mockMetrics);

      const result = await service.query('What is Apple revenue?', { ticker: 'AAPL' });

      expect(result.narratives).toEqual(mockNarratives);
      expect(result.metrics).toEqual(mockMetrics);
      expect(result.tenantFilter).toEqual({
        tenantId: 'tenant-a-id',
        includesPublic: true,
        includesPrivate: true,
      });
    });

    it('should not fetch metrics when ticker not provided', async () => {
      mockBedrockService.retrieve.mockResolvedValue([]);

      const result = await service.query('General financial question');

      expect(mockPrismaService.financialMetric.findMany).not.toHaveBeenCalled();
      expect(result.metrics).toEqual([]);
    });
  });

  describe('isDataSourceAccessible', () => {
    it('should return true for public data source', async () => {
      mockPrismaService.dataSource.findFirst.mockResolvedValue({
        id: 'public-source',
        visibility: 'public',
      });

      const result = await service.isDataSourceAccessible('public-source');

      expect(result).toBe(true);
    });

    it('should return true for owned data source', async () => {
      mockPrismaService.dataSource.findFirst.mockResolvedValue({
        id: 'owned-source',
        ownerTenantId: 'tenant-a-id',
      });

      const result = await service.isDataSourceAccessible('owned-source');

      expect(result).toBe(true);
    });

    it('should return false for other tenant data source', async () => {
      mockPrismaService.dataSource.findFirst.mockResolvedValue(null);

      const result = await service.isDataSourceAccessible('other-tenant-source');

      expect(result).toBe(false);
    });
  });
});
