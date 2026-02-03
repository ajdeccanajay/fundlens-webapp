/**
 * Tenant-Aware Prisma Service
 * 
 * Request-scoped service that automatically filters all database queries by tenant.
 * Ensures complete data isolation between tenants at the database layer.
 * 
 * Key Features:
 * - Automatic tenant_id injection into all queries
 * - 404 responses for cross-tenant access attempts (not 403 to prevent info leakage)
 * - Support for public data sources (SEC filings)
 * - Visibility-based access control for data sources
 */

import {
  Injectable,
  Scope,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext, TENANT_CONTEXT_KEY } from './tenant-context';
import { Prisma } from '@prisma/client';

@Injectable({ scope: Scope.REQUEST })
export class TenantAwarePrismaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  /**
   * Get the current tenant context from the request
   * Throws if no tenant context is available
   */
  get tenantContext(): TenantContext {
    const context = (this.request as any)[TENANT_CONTEXT_KEY];
    if (!context) {
      throw new Error('No tenant context available - ensure TenantGuard is applied');
    }
    return context;
  }

  /**
   * Get the current tenant ID
   */
  get tenantId(): string {
    return this.tenantContext.tenantId;
  }

  // ==================== DEALS ====================

  /**
   * Find all deals for the current tenant
   */
  async findDeals(options?: {
    where?: Prisma.DealWhereInput;
    orderBy?: Prisma.DealOrderByWithRelationInput;
    take?: number;
    skip?: number;
    include?: Prisma.DealInclude;
  }): Promise<any[]> {
    return this.prisma.deal.findMany({
      where: {
        ...options?.where,
        tenantId: this.tenantId,
      },
      orderBy: options?.orderBy || { updatedAt: 'desc' },
      take: options?.take,
      skip: options?.skip,
      include: options?.include,
    });
  }

  /**
   * Find a deal by ID, ensuring it belongs to the current tenant
   * Returns 404 if not found or belongs to another tenant
   */
  async findDealById(id: string, include?: Prisma.DealInclude): Promise<any> {
    const deal = await this.prisma.deal.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include,
    });

    if (!deal) {
      // Return 404 for both "not found" and "wrong tenant" to prevent info leakage
      throw new NotFoundException('Deal not found');
    }

    return deal;
  }

  /**
   * Create a new deal for the current tenant
   */
  async createDeal(data: Omit<Prisma.DealCreateInput, 'tenant'>): Promise<any> {
    return this.prisma.deal.create({
      data: {
        ...data,
        tenant: {
          connect: { id: this.tenantId },
        },
      },
    });
  }

  /**
   * Update a deal, verifying tenant ownership first
   */
  async updateDeal(id: string, data: Prisma.DealUpdateInput): Promise<any> {
    // Verify ownership first
    await this.findDealById(id);

    return this.prisma.deal.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a deal, verifying tenant ownership first
   */
  async deleteDeal(id: string): Promise<void> {
    // Verify ownership first
    await this.findDealById(id);

    await this.prisma.deal.delete({
      where: { id },
    });
  }

  /**
   * Count deals for the current tenant
   */
  async countDeals(where?: Prisma.DealWhereInput): Promise<number> {
    return this.prisma.deal.count({
      where: {
        ...where,
        tenantId: this.tenantId,
      },
    });
  }

  // ==================== DOCUMENTS ====================

  /**
   * Find all documents for the current tenant
   */
  async findDocuments(options?: {
    where?: Prisma.DocumentWhereInput;
    orderBy?: Prisma.DocumentOrderByWithRelationInput;
    take?: number;
    skip?: number;
    include?: Prisma.DocumentInclude;
  }): Promise<any[]> {
    return this.prisma.document.findMany({
      where: {
        ...options?.where,
        tenantId: this.tenantId,
      },
      orderBy: options?.orderBy || { uploadDate: 'desc' },
      take: options?.take,
      skip: options?.skip,
      include: options?.include,
    });
  }

  /**
   * Find a document by ID, ensuring it belongs to the current tenant
   */
  async findDocumentById(id: string, include?: Prisma.DocumentInclude): Promise<any> {
    const document = await this.prisma.document.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
      include,
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  /**
   * Create a new document for the current tenant
   */
  async createDocument(data: Omit<Prisma.DocumentCreateInput, 'tenant'>): Promise<any> {
    return this.prisma.document.create({
      data: {
        ...data,
        tenant: {
          connect: { id: this.tenantId },
        },
      },
    });
  }

  /**
   * Update a document, verifying tenant ownership first
   */
  async updateDocument(id: string, data: Prisma.DocumentUpdateInput): Promise<any> {
    await this.findDocumentById(id);

    return this.prisma.document.update({
      where: { id },
      data,
    });
  }

  /**
   * Delete a document, verifying tenant ownership first
   */
  async deleteDocument(id: string): Promise<void> {
    await this.findDocumentById(id);

    await this.prisma.document.delete({
      where: { id },
    });
  }

  // ==================== ANALYSIS SESSIONS ====================

  /**
   * Find analysis sessions for a deal owned by the current tenant
   */
  async findSessionsByDealId(dealId: string): Promise<any[]> {
    // Verify deal ownership first
    await this.findDealById(dealId);

    return this.prisma.analysisSession.findMany({
      where: { dealId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find an analysis session, verifying it belongs to a tenant-owned deal
   */
  async findSessionById(sessionId: string): Promise<any> {
    const session = await this.prisma.analysisSession.findUnique({
      where: { id: sessionId },
      include: { deal: true },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Verify the deal belongs to the current tenant
    if (session.deal.tenantId !== this.tenantId) {
      throw new NotFoundException('Session not found');
    }

    return session;
  }

  // ==================== CHAT MESSAGES ====================

  /**
   * Find chat messages for a session, verifying tenant ownership
   */
  async findMessagesBySessionId(sessionId: string, options?: {
    take?: number;
    skip?: number;
  }): Promise<any[]> {
    // Verify session ownership
    await this.findSessionById(sessionId);

    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      take: options?.take,
      skip: options?.skip,
    });
  }

  /**
   * Create a chat message, verifying session ownership
   */
  async createChatMessage(sessionId: string, data: {
    role: string;
    content: string;
    sources?: string;
    tokensUsed?: number;
    metadata?: any;
  }): Promise<any> {
    // Verify session ownership
    await this.findSessionById(sessionId);

    return this.prisma.chatMessage.create({
      data: {
        ...data,
        session: {
          connect: { id: sessionId },
        },
      },
    });
  }

  // ==================== DATA SOURCES ====================

  /**
   * Find accessible data sources for the current tenant
   * Includes: public sources + owned sources + granted access
   */
  async findAccessibleDataSources(options?: {
    type?: string;
    sourceId?: string;
  }): Promise<any[]> {
    const where: Prisma.DataSourceWhereInput = {
      OR: [
        // Public data sources (SEC filings, etc.)
        { visibility: 'public' },
        // Owned by this tenant
        { ownerTenantId: this.tenantId },
        // Granted access to this tenant
        {
          accessGrants: {
            some: {
              tenantId: this.tenantId,
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: new Date() } },
              ],
            },
          },
        },
      ],
    };

    if (options?.type) {
      where.type = options.type;
    }
    if (options?.sourceId) {
      where.sourceId = options.sourceId;
    }

    return this.prisma.dataSource.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Check if the current tenant has access to a specific data source
   */
  async hasAccessToDataSource(dataSourceId: string): Promise<boolean> {
    const dataSource = await this.prisma.dataSource.findFirst({
      where: {
        id: dataSourceId,
        OR: [
          { visibility: 'public' },
          { ownerTenantId: this.tenantId },
          {
            accessGrants: {
              some: {
                tenantId: this.tenantId,
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            },
          },
        ],
      },
    });

    return !!dataSource;
  }

  // ==================== FINANCIAL METRICS ====================

  /**
   * Find financial metrics from accessible data sources
   */
  async findAccessibleMetrics(options: {
    ticker: string;
    fiscalPeriod?: string;
    normalizedMetric?: string;
    take?: number;
  }): Promise<any[]> {
    // Get accessible data source IDs
    const accessibleSources = await this.findAccessibleDataSources();
    const sourceIds = accessibleSources.map(s => s.id);

    const where: Prisma.FinancialMetricWhereInput = {
      ticker: options.ticker.toUpperCase(),
    };

    // Only filter by dataSourceId if we have accessible sources
    // If no sources, return empty (no access to any data)
    if (sourceIds.length > 0) {
      where.OR = [
        { dataSourceId: { in: sourceIds } },
        { dataSourceId: null }, // Legacy data without data source
      ];
    }

    if (options.fiscalPeriod) {
      where.fiscalPeriod = options.fiscalPeriod;
    }
    if (options.normalizedMetric) {
      where.normalizedMetric = options.normalizedMetric;
    }

    return this.prisma.financialMetric.findMany({
      where,
      orderBy: { filingDate: 'desc' },
      take: options.take || 100,
    });
  }

  // ==================== NARRATIVE CHUNKS ====================

  /**
   * Find narrative chunks from accessible data sources
   */
  async findAccessibleNarrativeChunks(options: {
    ticker: string;
    filingType?: string;
    sectionType?: string;
    take?: number;
  }): Promise<any[]> {
    const accessibleSources = await this.findAccessibleDataSources();
    const sourceIds = accessibleSources.map(s => s.id);

    const where: Prisma.NarrativeChunkWhereInput = {
      ticker: options.ticker.toUpperCase(),
    };

    if (sourceIds.length > 0) {
      where.OR = [
        { dataSourceId: { in: sourceIds } },
        { dataSourceId: null },
      ];
    }

    if (options.filingType) {
      where.filingType = options.filingType;
    }
    if (options.sectionType) {
      where.sectionType = options.sectionType;
    }

    return this.prisma.narrativeChunk.findMany({
      where,
      orderBy: { chunkIndex: 'asc' },
      take: options.take || 50,
    });
  }

  // ==================== UPLOADED DOCUMENTS ====================

  /**
   * Find uploaded documents for the current tenant
   */
  async findUploadedDocuments(options?: {
    status?: string;
    tags?: string[];
    take?: number;
    skip?: number;
  }): Promise<any[]> {
    const where: Prisma.UploadedDocumentWhereInput = {
      tenantId: this.tenantId,
    };

    if (options?.status) {
      where.status = options.status;
    }
    if (options?.tags && options.tags.length > 0) {
      where.tags = { hasSome: options.tags };
    }

    return this.prisma.uploadedDocument.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      take: options?.take,
      skip: options?.skip,
    });
  }

  /**
   * Find an uploaded document by ID
   */
  async findUploadedDocumentById(id: string): Promise<any> {
    const doc = await this.prisma.uploadedDocument.findFirst({
      where: {
        id,
        tenantId: this.tenantId,
      },
    });

    if (!doc) {
      throw new NotFoundException('Uploaded document not found');
    }

    return doc;
  }

  // ==================== SCRATCH PADS ====================

  /**
   * Find scratch pad for a deal owned by the current tenant
   */
  async findScratchPadByDealId(dealId: string): Promise<any> {
    // Verify deal ownership
    await this.findDealById(dealId);

    return this.prisma.scratchPad.findUnique({
      where: { dealId },
    });
  }

  /**
   * Update scratch pad, verifying deal ownership
   */
  async updateScratchPad(dealId: string, content: string): Promise<any> {
    // Verify deal ownership
    await this.findDealById(dealId);

    return this.prisma.scratchPad.upsert({
      where: { dealId },
      update: {
        content,
        autoSavedAt: new Date(),
      },
      create: {
        dealId,
        content,
        title: 'Investment Analysis',
      },
    });
  }

  // ==================== RAW QUERIES ====================

  /**
   * Execute a raw query with automatic tenant filtering
   * Use with caution - prefer typed methods above
   */
  async executeRawWithTenant<T = any>(
    query: string,
    ...params: any[]
  ): Promise<T> {
    // Inject tenant_id as the first parameter
    const tenantQuery = query.replace(/\$(\d+)/g, (match, num) => {
      return `$${parseInt(num) + 1}`;
    });
    
    return this.prisma.$queryRawUnsafe(tenantQuery, this.tenantId, ...params);
  }
}
