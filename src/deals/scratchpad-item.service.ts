/**
 * Scratchpad Item Service
 * Feature: research-scratchpad-redesign
 * Requirements: 2.1, 2.2, 2.3, 2.4, 12.2, 12.3
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ScratchpadItem,
  SaveItemRequest,
  ExportRequest,
  ExportResponse,
  ItemType,
} from './scratchpad-item.types';

@Injectable()
export class ScratchpadItemService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all saved items for a workspace
   * Requirements: 2.1
   */
  async getItems(workspaceId: string): Promise<ScratchpadItem[]> {
    try {
      const items = await this.prisma.scratchpadItem.findMany({
        where: { workspaceId },
        orderBy: { savedAt: 'desc' },
      });

      return items.map((item) => ({
        id: item.id,
        workspaceId: item.workspaceId,
        type: item.type as ItemType,
        content: item.content as any,
        sources: (item.sources as any) || [],
        savedAt: item.savedAt.toISOString(),
        savedFrom: (item.savedFrom as any) || {},
        metadata: (item.metadata as any) || {},
      }));
    } catch (error) {
      // Log error but return empty array instead of throwing
      console.error('Error fetching scratchpad items:', error);
      return [];
    }
  }

  /**
   * Save a new item to the scratchpad
   * Requirements: 2.1
   */
  async saveItem(request: SaveItemRequest): Promise<ScratchpadItem> {
    // Validate item type
    const validTypes: ItemType[] = ['direct_answer', 'revenue_framework', 'trend_analysis', 'provocation'];
    if (!validTypes.includes(request.type)) {
      throw new BadRequestException(`Invalid item type: ${request.type}`);
    }

    // Validate content structure based on type
    this.validateContent(request.type, request.content);

    const item = await this.prisma.scratchpadItem.create({
      data: {
        workspaceId: request.workspaceId,
        type: request.type,
        content: request.content as any,
        sources: (request.sources || []) as any,
        savedAt: new Date(),
        savedFrom: (request.savedFrom || {}) as any,
        metadata: (request.metadata || {}) as any,
      },
    });

    return {
      id: item.id,
      workspaceId: item.workspaceId,
      type: item.type as ItemType,
      content: item.content as any,
      sources: (item.sources as any) || [],
      savedAt: item.savedAt.toISOString(),
      savedFrom: (item.savedFrom as any) || {},
      metadata: (item.metadata as any) || {},
    };
  }

  /**
   * Delete an item from the scratchpad
   * Requirements: 2.3, 2.4
   */
  async deleteItem(itemId: string): Promise<void> {
    const item = await this.prisma.scratchpadItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      throw new NotFoundException(`Scratchpad item ${itemId} not found`);
    }

    await this.prisma.scratchpadItem.delete({
      where: { id: itemId },
    });
  }

  /**
   * Export scratchpad items in various formats
   * Requirements: 12.2, 12.3
   */
  async exportItems(request: ExportRequest): Promise<ExportResponse> {
    // Fetch items
    const where: any = { workspaceId: request.workspaceId };
    if (request.itemIds && request.itemIds.length > 0) {
      where.id = { in: request.itemIds };
    }

    const items = await this.prisma.scratchpadItem.findMany({
      where,
      orderBy: { savedAt: 'desc' },
    });

    const scratchpadItems: ScratchpadItem[] = items.map((item) => ({
      id: item.id,
      workspaceId: item.workspaceId,
      type: item.type as ItemType,
      content: item.content as any,
      sources: (item.sources as any) || [],
      savedAt: item.savedAt.toISOString(),
      savedFrom: (item.savedFrom as any) || {},
      metadata: (item.metadata as any) || {},
    }));

    // Generate export based on format
    switch (request.format) {
      case 'markdown':
        return this.exportAsMarkdown(scratchpadItems);
      case 'text':
        return this.exportAsText(scratchpadItems);
      case 'json':
        return this.exportAsJson(scratchpadItems);
      default:
        throw new BadRequestException(`Invalid export format: ${request.format}`);
    }
  }

  /**
   * Validate content structure based on item type
   */
  private validateContent(type: ItemType, content: any): void {
    switch (type) {
      case 'direct_answer':
        if (!content.text || typeof content.text !== 'string') {
          throw new BadRequestException('DirectAnswer must have a text field');
        }
        if (content.sourceCount === undefined || typeof content.sourceCount !== 'number') {
          throw new BadRequestException('DirectAnswer must have a sourceCount field');
        }
        break;
      case 'revenue_framework':
        if (!Array.isArray(content.pointInTime) || !Array.isArray(content.overTime)) {
          throw new BadRequestException('RevenueFramework must have pointInTime and overTime arrays');
        }
        break;
      case 'trend_analysis':
        if (!content.metric || !Array.isArray(content.data)) {
          throw new BadRequestException('TrendAnalysis must have metric and data fields');
        }
        break;
      case 'provocation':
        if (!content.question || typeof content.question !== 'string') {
          throw new BadRequestException('Provocation must have a question field');
        }
        break;
    }
  }

  /**
   * Export items as Markdown
   */
  private exportAsMarkdown(items: ScratchpadItem[]): ExportResponse {
    let markdown = '# Research Scratchpad\n\n';
    markdown += `Generated: ${new Date().toISOString()}\n\n`;
    markdown += `Total Items: ${items.length}\n\n`;
    markdown += '---\n\n';

    items.forEach((item, index) => {
      markdown += `## ${index + 1}. ${this.getItemTypeLabel(item.type)}\n\n`;
      markdown += `**Saved:** ${new Date(item.savedAt).toLocaleString()}\n\n`;

      switch (item.type) {
        case 'direct_answer':
          const da = item.content as any;
          markdown += `${da.text}\n\n`;
          if (da.confidence) {
            markdown += `*Confidence: ${da.confidence}*\n\n`;
          }
          markdown += `*Sources: ${da.sourceCount} SEC filings*\n\n`;
          break;
        case 'revenue_framework':
          const rf = item.content as any;
          markdown += '### Point-in-Time Recognition\n\n';
          rf.pointInTime.forEach((cat: any) => {
            markdown += `- ${cat.name}\n`;
          });
          markdown += '\n### Over-Time Recognition\n\n';
          rf.overTime.forEach((cat: any) => {
            markdown += `- ${cat.name}\n`;
          });
          markdown += '\n';
          break;
        case 'trend_analysis':
          const ta = item.content as any;
          markdown += `**Metric:** ${ta.metric}\n\n`;
          markdown += '| Year | Value | YoY Change |\n';
          markdown += '|------|-------|------------|\n';
          ta.data.forEach((d: any) => {
            markdown += `| ${d.year} | $${d.value}M | ${d.yoyChange > 0 ? '+' : ''}${d.yoyChange}% |\n`;
          });
          markdown += '\n';
          break;
        case 'provocation':
          const prov = item.content as any;
          markdown += `> ${prov.question}\n\n`;
          break;
      }

      if (item.sources && item.sources.length > 0) {
        markdown += '**Sources:**\n\n';
        item.sources.forEach((source) => {
          markdown += `- [${source.ticker} ${source.filingType} - ${source.filingDate}](${source.url})\n`;
        });
        markdown += '\n';
      }

      markdown += '---\n\n';
    });

    return {
      content: markdown,
      filename: `scratchpad-${Date.now()}.md`,
    };
  }

  /**
   * Export items as plain text
   */
  private exportAsText(items: ScratchpadItem[]): ExportResponse {
    let text = 'RESEARCH SCRATCHPAD\n\n';
    text += `Generated: ${new Date().toISOString()}\n`;
    text += `Total Items: ${items.length}\n\n`;
    text += '='.repeat(80) + '\n\n';

    items.forEach((item, index) => {
      text += `${index + 1}. ${this.getItemTypeLabel(item.type).toUpperCase()}\n`;
      text += `Saved: ${new Date(item.savedAt).toLocaleString()}\n\n`;

      switch (item.type) {
        case 'direct_answer':
          const da = item.content as any;
          text += `${da.text}\n\n`;
          if (da.confidence) {
            text += `Confidence: ${da.confidence}\n`;
          }
          text += `Sources: ${da.sourceCount} SEC filings\n\n`;
          break;
        case 'revenue_framework':
          const rf = item.content as any;
          text += 'Point-in-Time Recognition:\n';
          rf.pointInTime.forEach((cat: any) => {
            text += `  - ${cat.name}\n`;
          });
          text += '\nOver-Time Recognition:\n';
          rf.overTime.forEach((cat: any) => {
            text += `  - ${cat.name}\n`;
          });
          text += '\n';
          break;
        case 'trend_analysis':
          const ta = item.content as any;
          text += `Metric: ${ta.metric}\n\n`;
          ta.data.forEach((d: any) => {
            text += `  ${d.year}: $${d.value}M (${d.yoyChange > 0 ? '+' : ''}${d.yoyChange}%)\n`;
          });
          text += '\n';
          break;
        case 'provocation':
          const prov = item.content as any;
          text += `"${prov.question}"\n\n`;
          break;
      }

      if (item.sources && item.sources.length > 0) {
        text += 'Sources:\n';
        item.sources.forEach((source) => {
          text += `  - ${source.ticker} ${source.filingType} (${source.filingDate})\n`;
        });
        text += '\n';
      }

      text += '-'.repeat(80) + '\n\n';
    });

    return {
      content: text,
      filename: `scratchpad-${Date.now()}.txt`,
    };
  }

  /**
   * Export items as JSON
   */
  private exportAsJson(items: ScratchpadItem[]): ExportResponse {
    const json = JSON.stringify(
      {
        generated: new Date().toISOString(),
        totalCount: items.length,
        items,
      },
      null,
      2,
    );

    return {
      content: json,
      filename: `scratchpad-${Date.now()}.json`,
    };
  }

  /**
   * Get human-readable label for item type
   */
  private getItemTypeLabel(type: ItemType): string {
    const labels: Record<ItemType, string> = {
      direct_answer: 'Direct Answer',
      revenue_framework: 'Revenue Framework',
      trend_analysis: 'Trend Analysis',
      provocation: 'Provocation',
    };
    return labels[type] || type;
  }
}
