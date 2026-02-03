/**
 * Unit Tests for Scratchpad Item Service
 * Feature: research-scratchpad-redesign
 * Requirements: 2.1, 2.2, 2.3, 2.4, 12.2, 12.3
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ScratchpadItemService } from '../../src/deals/scratchpad-item.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ScratchpadItem,
  SaveItemRequest,
  DirectAnswer,
  RevenueFramework,
  TrendAnalysis,
  Provocation,
} from '../../src/deals/scratchpad-item.types';

describe('ScratchpadItemService', () => {
  let service: ScratchpadItemService;
  let prisma: PrismaService;

  const mockPrismaService = {
    scratchpadItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScratchpadItemService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<ScratchpadItemService>(ScratchpadItemService);
    prisma = module.get<PrismaService>(PrismaService);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('getItems', () => {
    it('should fetch all items for a workspace ordered by savedAt desc', async () => {
      // Requirement: 2.1
      const workspaceId = 'workspace-123';
      const mockItems = [
        {
          id: 'item-1',
          workspaceId,
          type: 'direct_answer',
          content: { text: 'Answer 1', sourceCount: 3 },
          sources: [],
          savedAt: new Date('2026-02-03T10:00:00Z'),
          savedFrom: {},
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'item-2',
          workspaceId,
          type: 'trend_analysis',
          content: { metric: 'Revenue', data: [] },
          sources: [],
          savedAt: new Date('2026-02-03T09:00:00Z'),
          savedFrom: {},
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockPrismaService.scratchpadItem.findMany.mockResolvedValue(mockItems);

      const result = await service.getItems(workspaceId);

      expect(prisma.scratchpadItem.findMany).toHaveBeenCalledWith({
        where: { workspaceId },
        orderBy: { savedAt: 'desc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('item-1');
      expect(result[1].id).toBe('item-2');
    });

    it('should return empty array when no items exist', async () => {
      // Requirement: 2.2
      const workspaceId = 'workspace-empty';
      mockPrismaService.scratchpadItem.findMany.mockResolvedValue([]);

      const result = await service.getItems(workspaceId);

      expect(result).toEqual([]);
    });

    it('should transform database items to ScratchpadItem format', async () => {
      const workspaceId = 'workspace-123';
      const mockItem = {
        id: 'item-1',
        workspaceId,
        type: 'direct_answer',
        content: { text: 'Test answer', sourceCount: 5 },
        sources: [{ filingType: '10-K', filingDate: '2025-12-31', url: 'https://sec.gov', ticker: 'AAPL' }],
        savedAt: new Date('2026-02-03T10:00:00Z'),
        savedFrom: { chatMessageId: 'msg-1', query: 'What is revenue?' },
        metadata: { ticker: 'AAPL', tags: ['revenue'] },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.scratchpadItem.findMany.mockResolvedValue([mockItem]);

      const result = await service.getItems(workspaceId);

      expect(result[0]).toMatchObject({
        id: 'item-1',
        workspaceId,
        type: 'direct_answer',
        content: { text: 'Test answer', sourceCount: 5 },
        sources: [{ filingType: '10-K', filingDate: '2025-12-31', url: 'https://sec.gov', ticker: 'AAPL' }],
        savedAt: '2026-02-03T10:00:00.000Z',
        savedFrom: { chatMessageId: 'msg-1', query: 'What is revenue?' },
        metadata: { ticker: 'AAPL', tags: ['revenue'] },
      });
    });
  });

  describe('saveItem', () => {
    it('should save a direct answer item successfully', async () => {
      // Requirement: 2.1
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'direct_answer',
        content: {
          text: 'Apple generated $394.3B in revenue for FY2023',
          confidence: 'high',
          sourceCount: 3,
        } as DirectAnswer,
        sources: [
          {
            filingType: '10-K',
            filingDate: '2023-11-03',
            url: 'https://sec.gov/aapl-10k',
            ticker: 'AAPL',
          },
        ],
        savedFrom: {
          chatMessageId: 'msg-123',
          query: 'What was Apple revenue in 2023?',
        },
        metadata: {
          ticker: 'AAPL',
          filingPeriod: 'FY2023',
        },
      };

      const mockCreatedItem = {
        id: 'item-new',
        ...request,
        savedAt: new Date('2026-02-03T10:00:00Z'),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.scratchpadItem.create.mockResolvedValue(mockCreatedItem);

      const result = await service.saveItem(request);

      expect(prisma.scratchpadItem.create).toHaveBeenCalledWith({
        data: {
          workspaceId: request.workspaceId,
          type: request.type,
          content: request.content,
          sources: request.sources,
          savedAt: expect.any(Date),
          savedFrom: request.savedFrom,
          metadata: request.metadata,
        },
      });
      expect(result.id).toBe('item-new');
      expect(result.type).toBe('direct_answer');
    });

    it('should save a revenue framework item successfully', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'revenue_framework',
        content: {
          pointInTime: [
            { name: 'iPhone', icon: 'phone' },
            { name: 'Mac', icon: 'laptop' },
          ],
          overTime: [
            { name: 'Services', icon: 'services' },
          ],
        } as RevenueFramework,
      };

      const mockCreatedItem = {
        id: 'item-framework',
        ...request,
        sources: [],
        savedAt: new Date(),
        savedFrom: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.scratchpadItem.create.mockResolvedValue(mockCreatedItem);

      const result = await service.saveItem(request);

      expect(result.type).toBe('revenue_framework');
      expect((result.content as RevenueFramework).pointInTime).toHaveLength(2);
    });

    it('should save a trend analysis item successfully', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'trend_analysis',
        content: {
          metric: 'Revenue',
          data: [
            { year: 2023, value: 394328, yoyChange: 2.8 },
            { year: 2022, value: 383285, yoyChange: 7.8 },
            { year: 2021, value: 365817, yoyChange: 33.3 },
          ],
        } as TrendAnalysis,
      };

      const mockCreatedItem = {
        id: 'item-trend',
        ...request,
        sources: [],
        savedAt: new Date(),
        savedFrom: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.scratchpadItem.create.mockResolvedValue(mockCreatedItem);

      const result = await service.saveItem(request);

      expect(result.type).toBe('trend_analysis');
      expect((result.content as TrendAnalysis).data).toHaveLength(3);
    });

    it('should save a provocation item successfully', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'provocation',
        content: {
          question: 'How might Apple\'s services mix shift impact revenue recognition patterns over the next 3 years?',
          context: 'Services revenue growing faster than hardware',
        } as Provocation,
      };

      const mockCreatedItem = {
        id: 'item-prov',
        ...request,
        sources: [],
        savedAt: new Date(),
        savedFrom: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.scratchpadItem.create.mockResolvedValue(mockCreatedItem);

      const result = await service.saveItem(request);

      expect(result.type).toBe('provocation');
      expect((result.content as Provocation).question).toContain('services mix');
    });

    it('should throw BadRequestException for invalid item type', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'invalid_type' as any,
        content: {},
      };

      await expect(service.saveItem(request)).rejects.toThrow(BadRequestException);
      await expect(service.saveItem(request)).rejects.toThrow('Invalid item type: invalid_type');
    });

    it('should throw BadRequestException for invalid DirectAnswer content', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'direct_answer',
        content: { text: 'Missing sourceCount' } as any,
      };

      await expect(service.saveItem(request)).rejects.toThrow(BadRequestException);
      await expect(service.saveItem(request)).rejects.toThrow('DirectAnswer must have a sourceCount field');
    });

    it('should throw BadRequestException for invalid RevenueFramework content', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'revenue_framework',
        content: { pointInTime: [] } as any, // Missing overTime
      };

      await expect(service.saveItem(request)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid TrendAnalysis content', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'trend_analysis',
        content: { metric: 'Revenue' } as any, // Missing data
      };

      await expect(service.saveItem(request)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for invalid Provocation content', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'provocation',
        content: { context: 'Missing question' } as any,
      };

      await expect(service.saveItem(request)).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteItem', () => {
    it('should delete an existing item successfully', async () => {
      // Requirement: 2.3, 2.4
      const itemId = 'item-to-delete';
      const mockItem = {
        id: itemId,
        workspaceId: 'workspace-123',
        type: 'direct_answer',
        content: {},
        sources: [],
        savedAt: new Date(),
        savedFrom: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.scratchpadItem.findUnique.mockResolvedValue(mockItem);
      mockPrismaService.scratchpadItem.delete.mockResolvedValue(mockItem);

      await service.deleteItem(itemId);

      expect(prisma.scratchpadItem.findUnique).toHaveBeenCalledWith({
        where: { id: itemId },
      });
      expect(prisma.scratchpadItem.delete).toHaveBeenCalledWith({
        where: { id: itemId },
      });
    });

    it('should throw NotFoundException when item does not exist', async () => {
      // Requirement: 2.3
      const itemId = 'non-existent-item';
      mockPrismaService.scratchpadItem.findUnique.mockResolvedValue(null);

      await expect(service.deleteItem(itemId)).rejects.toThrow(NotFoundException);
      await expect(service.deleteItem(itemId)).rejects.toThrow(`Scratchpad item ${itemId} not found`);
      expect(prisma.scratchpadItem.delete).not.toHaveBeenCalled();
    });
  });

  describe('exportItems', () => {
    const mockItems = [
      {
        id: 'item-1',
        workspaceId: 'workspace-123',
        type: 'direct_answer',
        content: { text: 'Apple revenue was $394.3B', confidence: 'high', sourceCount: 3 },
        sources: [{ filingType: '10-K', filingDate: '2023-11-03', url: 'https://sec.gov', ticker: 'AAPL' }],
        savedAt: new Date('2026-02-03T10:00:00Z'),
        savedFrom: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'item-2',
        workspaceId: 'workspace-123',
        type: 'trend_analysis',
        content: {
          metric: 'Revenue',
          data: [
            { year: 2023, value: 394328, yoyChange: 2.8 },
            { year: 2022, value: 383285, yoyChange: 7.8 },
          ],
        },
        sources: [],
        savedAt: new Date('2026-02-03T09:00:00Z'),
        savedFrom: {},
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    it('should export all items as markdown', async () => {
      // Requirement: 12.2
      mockPrismaService.scratchpadItem.findMany.mockResolvedValue(mockItems);

      const result = await service.exportItems({
        workspaceId: 'workspace-123',
        format: 'markdown',
      });

      expect(result.content).toContain('# Research Scratchpad');
      expect(result.content).toContain('## 1. Direct Answer');
      expect(result.content).toContain('Apple revenue was $394.3B');
      expect(result.content).toContain('## 2. Trend Analysis');
      expect(result.content).toContain('**Metric:** Revenue');
      expect(result.filename).toMatch(/scratchpad-\d+\.md/);
    });

    it('should export all items as text', async () => {
      // Requirement: 12.3
      mockPrismaService.scratchpadItem.findMany.mockResolvedValue(mockItems);

      const result = await service.exportItems({
        workspaceId: 'workspace-123',
        format: 'text',
      });

      expect(result.content).toContain('RESEARCH SCRATCHPAD');
      expect(result.content).toContain('1. DIRECT ANSWER');
      expect(result.content).toContain('Apple revenue was $394.3B');
      expect(result.content).toContain('2. TREND ANALYSIS');
      expect(result.filename).toMatch(/scratchpad-\d+\.txt/);
    });

    it('should export all items as JSON', async () => {
      mockPrismaService.scratchpadItem.findMany.mockResolvedValue(mockItems);

      const result = await service.exportItems({
        workspaceId: 'workspace-123',
        format: 'json',
      });

      const parsed = JSON.parse(result.content);
      expect(parsed.totalCount).toBe(2);
      expect(parsed.items).toHaveLength(2);
      expect(parsed.items[0].type).toBe('direct_answer');
      expect(result.filename).toMatch(/scratchpad-\d+\.json/);
    });

    it('should export only specified items when itemIds provided', async () => {
      mockPrismaService.scratchpadItem.findMany.mockResolvedValue([mockItems[0]]);

      const result = await service.exportItems({
        workspaceId: 'workspace-123',
        format: 'markdown',
        itemIds: ['item-1'],
      });

      expect(prisma.scratchpadItem.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: 'workspace-123',
          id: { in: ['item-1'] },
        },
        orderBy: { savedAt: 'desc' },
      });
      expect(result.content).toContain('Total Items: 1');
    });

    it('should throw BadRequestException for invalid export format', async () => {
      await expect(
        service.exportItems({
          workspaceId: 'workspace-123',
          format: 'invalid' as any,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
