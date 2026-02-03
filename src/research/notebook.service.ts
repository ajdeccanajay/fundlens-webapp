/**
 * Notebook Service
 * 
 * Manages research notebooks and insights with full tenant isolation.
 * 
 * Features:
 * - Notebook CRUD operations
 * - Insight management
 * - Reordering
 * - Markdown export
 * - Tenant/user isolation
 * 
 * SECURITY: All operations verify tenant and user ownership.
 */

import {
  Injectable,
  Scope,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext, TENANT_CONTEXT_KEY } from '../tenant/tenant-context';

export interface CreateNotebookDto {
  title: string;
  description?: string;
}

export interface UpdateNotebookDto {
  title?: string;
  description?: string;
  isArchived?: boolean;
}

export interface CreateInsightDto {
  content: string;
  selectedText?: string;
  userNotes?: string;
  tags?: string[];
  companies?: string[];
  messageId?: string;
}

export interface UpdateInsightDto {
  content?: string;
  selectedText?: string;
  userNotes?: string;
  tags?: string[];
  companies?: string[];
}

/**
 * Request-scoped Notebook Service
 * Ensures tenant context is properly isolated per request
 */
@Injectable({ scope: Scope.REQUEST })
export class NotebookService {
  private readonly logger = new Logger(NotebookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REQUEST) private readonly request: Request,
  ) {}

  /**
   * Get tenant context from request
   */
  private getTenantContext(): TenantContext {
    const context = (this.request as any)?.[TENANT_CONTEXT_KEY] as TenantContext;
    if (!context) {
      throw new Error('Tenant context not found');
    }
    return context;
  }

  /**
   * Get tenant ID from context
   */
  private getTenantId(): string {
    return this.getTenantContext().tenantId;
  }

  /**
   * Get user ID from context
   */
  private getUserId(): string {
    return this.getTenantContext().userId;
  }

  /**
   * Create a new notebook
   * SECURITY: Notebook is automatically associated with current tenant/user
   */
  async createNotebook(dto: CreateNotebookDto) {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    this.logger.log(`Creating notebook for tenant ${tenantId}, user ${userId}: ${dto.title}`);

    return this.prisma.notebook.create({
      data: {
        tenantId,
        userId,
        title: dto.title,
        description: dto.description,
      },
      include: {
        _count: {
          select: { insights: true },
        },
      },
    });
  }

  /**
   * List notebooks for current tenant/user
   * SECURITY: Filters by tenant_id and user_id
   */
  async listNotebooks(options?: {
    archived?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{
    data: any[];
    pagination: { total: number; hasMore: boolean; limit: number; offset: number };
  }> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const where: any = { tenantId, userId };
    if (options?.archived !== undefined) {
      where.isArchived = options.archived;
    }

    const [data, total] = await Promise.all([
      this.prisma.notebook.findMany({
        where,
        include: {
          _count: {
            select: { insights: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notebook.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        hasMore: offset + data.length < total,
        limit,
        offset,
      },
    };
  }

  /**
   * Get notebook by ID with insights
   * SECURITY: Verifies tenant and user ownership
   */
  async getNotebook(notebookId: string): Promise<{
    notebook: any;
    insights: any[];
  }> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    const notebook = await this.prisma.notebook.findFirst({
      where: {
        id: notebookId,
        tenantId,
        userId,
      },
      include: {
        insights: {
          orderBy: { position: 'asc' },
        },
      },
    });

    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }

    const { insights, ...notebookData } = notebook;

    return {
      notebook: notebookData,
      insights,
    };
  }

  /**
   * Update notebook
   * SECURITY: Verifies tenant and user ownership
   */
  async updateNotebook(notebookId: string, dto: UpdateNotebookDto) {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify ownership
    const existing = await this.prisma.notebook.findFirst({
      where: {
        id: notebookId,
        tenantId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Notebook not found');
    }

    return this.prisma.notebook.update({
      where: { id: notebookId },
      data: {
        ...dto,
        updatedAt: new Date(),
      },
      include: {
        _count: {
          select: { insights: true },
        },
      },
    });
  }

  /**
   * Delete notebook
   * SECURITY: Verifies tenant and user ownership
   */
  async deleteNotebook(notebookId: string): Promise<{ success: boolean }> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify ownership
    const existing = await this.prisma.notebook.findFirst({
      where: {
        id: notebookId,
        tenantId,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Notebook not found');
    }

    await this.prisma.notebook.delete({
      where: { id: notebookId },
    });

    this.logger.log(`Deleted notebook ${notebookId} for tenant ${tenantId}`);

    return { success: true };
  }

  /**
   * Add insight to notebook
   * SECURITY: Verifies notebook ownership
   */
  async addInsight(notebookId: string, dto: CreateInsightDto) {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify notebook ownership
    const notebook = await this.prisma.notebook.findFirst({
      where: {
        id: notebookId,
        tenantId,
        userId,
      },
    });

    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }

    // Get max position
    const maxPositionInsight = await this.prisma.insight.findFirst({
      where: { notebookId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const position = maxPositionInsight ? maxPositionInsight.position + 1 : 0;

    // Create insight
    const insight = await this.prisma.insight.create({
      data: {
        notebookId,
        messageId: dto.messageId,
        content: dto.content,
        selectedText: dto.selectedText,
        userNotes: dto.userNotes,
        tags: dto.tags || [],
        companies: dto.companies || [],
        position,
      },
    });

    // Update notebook insight count
    await this.prisma.notebook.update({
      where: { id: notebookId },
      data: {
        insightCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    return insight;
  }

  /**
   * Update insight
   * SECURITY: Verifies notebook ownership
   */
  async updateInsight(
    notebookId: string,
    insightId: string,
    dto: UpdateInsightDto,
  ) {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify notebook ownership
    const notebook = await this.prisma.notebook.findFirst({
      where: {
        id: notebookId,
        tenantId,
        userId,
      },
    });

    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }

    // Verify insight belongs to notebook
    const existing = await this.prisma.insight.findFirst({
      where: {
        id: insightId,
        notebookId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Insight not found');
    }

    // Update insight
    const insight = await this.prisma.insight.update({
      where: { id: insightId },
      data: {
        ...dto,
        updatedAt: new Date(),
      },
    });

    // Update notebook timestamp
    await this.prisma.notebook.update({
      where: { id: notebookId },
      data: { updatedAt: new Date() },
    });

    return insight;
  }

  /**
   * Delete insight
   * SECURITY: Verifies notebook ownership
   */
  async deleteInsight(
    notebookId: string,
    insightId: string,
  ): Promise<{ success: boolean }> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify notebook ownership
    const notebook = await this.prisma.notebook.findFirst({
      where: {
        id: notebookId,
        tenantId,
        userId,
      },
    });

    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }

    // Verify insight belongs to notebook
    const existing = await this.prisma.insight.findFirst({
      where: {
        id: insightId,
        notebookId,
      },
    });

    if (!existing) {
      throw new NotFoundException('Insight not found');
    }

    // Delete insight
    await this.prisma.insight.delete({
      where: { id: insightId },
    });

    // Update notebook insight count
    await this.prisma.notebook.update({
      where: { id: notebookId },
      data: {
        insightCount: { decrement: 1 },
        updatedAt: new Date(),
      },
    });

    return { success: true };
  }

  /**
   * Reorder insights
   * SECURITY: Verifies notebook ownership
   */
  async reorderInsights(
    notebookId: string,
    insightIds: string[],
  ): Promise<{ success: boolean }> {
    const tenantId = this.getTenantId();
    const userId = this.getUserId();

    // Verify notebook ownership
    const notebook = await this.prisma.notebook.findFirst({
      where: {
        id: notebookId,
        tenantId,
        userId,
      },
    });

    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }

    // Get all insights for notebook
    const insights = await this.prisma.insight.findMany({
      where: { notebookId },
      select: { id: true, notebookId: true },
    });

    // Verify all insight IDs belong to notebook
    const insightIdSet = new Set(insights.map((i) => i.id));
    for (const id of insightIds) {
      if (!insightIdSet.has(id)) {
        throw new BadRequestException(`Insight ${id} does not belong to notebook`);
      }
    }

    // Update positions
    for (let i = 0; i < insightIds.length; i++) {
      await this.prisma.insight.update({
        where: { id: insightIds[i] },
        data: { position: i },
      });
    }

    // Update notebook timestamp
    await this.prisma.notebook.update({
      where: { id: notebookId },
      data: { updatedAt: new Date() },
    });

    return { success: true };
  }

  /**
   * Export notebook as Markdown
   * SECURITY: Verifies notebook ownership
   */
  async exportMarkdown(notebookId: string): Promise<string> {
    const { notebook, insights } = await this.getNotebook(notebookId);

    const lines: string[] = [];

    // Title
    lines.push(`# ${notebook.title}`);
    lines.push('');

    // Description
    if (notebook.description) {
      lines.push(notebook.description);
      lines.push('');
    }

    // Metadata
    lines.push(`**Created**: ${notebook.createdAt.toLocaleDateString()}`);
    lines.push(`**Last Updated**: ${notebook.updatedAt.toLocaleDateString()}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Insights
    for (const insight of insights) {
      lines.push(`## Insight ${insight.position + 1}`);
      lines.push('');

      // Selected text (quote)
      if (insight.selectedText) {
        lines.push(`> ${insight.selectedText}`);
        lines.push('');
      }

      // Content
      lines.push(insight.content);
      lines.push('');

      // User notes
      if (insight.userNotes) {
        lines.push(`**Notes**: ${insight.userNotes}`);
        lines.push('');
      }

      // Tags
      if (insight.tags && insight.tags.length > 0) {
        lines.push(`**Tags**: ${insight.tags.join(', ')}`);
        lines.push('');
      }

      // Companies
      if (insight.companies && insight.companies.length > 0) {
        lines.push(`**Companies**: ${insight.companies.join(', ')}`);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }
}
