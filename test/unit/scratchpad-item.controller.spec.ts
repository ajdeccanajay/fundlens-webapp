/**
 * Unit Tests for Scratchpad Item Controller
 * Feature: research-scratchpad-redesign
 * Requirements: 2.1, 2.2, 2.3, 2.4, 12.2, 12.3
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ScratchpadItemController } from '../../src/deals/scratchpad-item.controller';
import { ScratchpadItemService } from '../../src/deals/scratchpad-item.service';
import {
  ScratchpadItem,
  SaveItemRequest,
  ExportRequest,
} from '../../src/deals/scratchpad-item.types';

describe('ScratchpadItemController', () => {
  let controller: ScratchpadItemController;
  let service: ScratchpadItemService;

  const mockScratchpadItemService = {
    getItems: jest.fn(),
    saveItem: jest.fn(),
    deleteItem: jest.fn(),
    exportItems: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ScratchpadItemController],
      providers: [
        {
          provide: ScratchpadItemService,
          useValue: mockScratchpadItemService,
        },
      ],
    }).compile();

    controller = module.get<ScratchpadItemController>(ScratchpadItemController);
    service = module.get<ScratchpadItemService>(ScratchpadItemService);

    jest.clearAllMocks();
  });

  describe('getItems', () => {
    it('should return items and total count for a workspace', async () => {
      // Requirement: 2.1
      const workspaceId = 'workspace-123';
      const mockItems: ScratchpadItem[] = [
        {
          id: 'item-1',
          workspaceId,
          type: 'direct_answer',
          content: { text: 'Answer 1', sourceCount: 3 },
          sources: [],
          savedAt: '2026-02-03T10:00:00.000Z',
          savedFrom: {},
          metadata: {},
        },
        {
          id: 'item-2',
          workspaceId,
          type: 'trend_analysis',
          content: { metric: 'Revenue', data: [] },
          sources: [],
          savedAt: '2026-02-03T09:00:00.000Z',
          savedFrom: {},
          metadata: {},
        },
      ];

      mockScratchpadItemService.getItems.mockResolvedValue(mockItems);

      const result = await controller.getItems(workspaceId);

      expect(service.getItems).toHaveBeenCalledWith(workspaceId);
      expect(result.items).toEqual(mockItems);
      expect(result.totalCount).toBe(2);
    });

    it('should return empty array when no items exist', async () => {
      // Requirement: 2.2
      const workspaceId = 'workspace-empty';
      mockScratchpadItemService.getItems.mockResolvedValue([]);

      const result = await controller.getItems(workspaceId);

      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('saveItem', () => {
    it('should save a direct answer item and return it', async () => {
      // Requirement: 2.1
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'direct_answer',
        content: {
          text: 'Apple generated $394.3B in revenue for FY2023',
          confidence: 'high',
          sourceCount: 3,
        },
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

      const mockSavedItem: ScratchpadItem = {
        id: 'item-new',
        ...request,
        savedAt: '2026-02-03T10:00:00.000Z',
      };

      mockScratchpadItemService.saveItem.mockResolvedValue(mockSavedItem);

      const result = await controller.saveItem(request);

      expect(service.saveItem).toHaveBeenCalledWith(request);
      expect(result.item).toEqual(mockSavedItem);
      expect(result.item.id).toBe('item-new');
    });

    it('should save a revenue framework item', async () => {
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
        },
      };

      const mockSavedItem: ScratchpadItem = {
        id: 'item-framework',
        ...request,
        sources: [],
        savedAt: '2026-02-03T10:00:00.000Z',
        savedFrom: {},
        metadata: {},
      };

      mockScratchpadItemService.saveItem.mockResolvedValue(mockSavedItem);

      const result = await controller.saveItem(request);

      expect(result.item.type).toBe('revenue_framework');
    });

    it('should save a trend analysis item', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'trend_analysis',
        content: {
          metric: 'Revenue',
          data: [
            { year: 2023, value: 394328, yoyChange: 2.8 },
            { year: 2022, value: 383285, yoyChange: 7.8 },
          ],
        },
      };

      const mockSavedItem: ScratchpadItem = {
        id: 'item-trend',
        ...request,
        sources: [],
        savedAt: '2026-02-03T10:00:00.000Z',
        savedFrom: {},
        metadata: {},
      };

      mockScratchpadItemService.saveItem.mockResolvedValue(mockSavedItem);

      const result = await controller.saveItem(request);

      expect(result.item.type).toBe('trend_analysis');
    });

    it('should save a provocation item', async () => {
      const request: SaveItemRequest = {
        workspaceId: 'workspace-123',
        type: 'provocation',
        content: {
          question: 'How might Apple\'s services mix shift impact revenue recognition?',
        },
      };

      const mockSavedItem: ScratchpadItem = {
        id: 'item-prov',
        ...request,
        sources: [],
        savedAt: '2026-02-03T10:00:00.000Z',
        savedFrom: {},
        metadata: {},
      };

      mockScratchpadItemService.saveItem.mockResolvedValue(mockSavedItem);

      const result = await controller.saveItem(request);

      expect(result.item.type).toBe('provocation');
    });
  });

  describe('deleteItem', () => {
    it('should delete an item and return success', async () => {
      // Requirement: 2.3, 2.4
      const itemId = 'item-to-delete';
      mockScratchpadItemService.deleteItem.mockResolvedValue(undefined);

      const result = await controller.deleteItem(itemId);

      expect(service.deleteItem).toHaveBeenCalledWith(itemId);
      expect(result.success).toBe(true);
    });
  });

  describe('exportItems', () => {
    it('should export items as markdown', async () => {
      // Requirement: 12.2
      const request: ExportRequest = {
        workspaceId: 'workspace-123',
        format: 'markdown',
      };

      const mockExportResponse = {
        content: '# Research Scratchpad\n\n...',
        filename: 'scratchpad-1234567890.md',
      };

      mockScratchpadItemService.exportItems.mockResolvedValue(mockExportResponse);

      const result = await controller.exportItems(request);

      expect(service.exportItems).toHaveBeenCalledWith(request);
      expect(result.content).toContain('# Research Scratchpad');
      expect(result.filename).toMatch(/\.md$/);
    });

    it('should export items as text', async () => {
      // Requirement: 12.3
      const request: ExportRequest = {
        workspaceId: 'workspace-123',
        format: 'text',
      };

      const mockExportResponse = {
        content: 'RESEARCH SCRATCHPAD\n\n...',
        filename: 'scratchpad-1234567890.txt',
      };

      mockScratchpadItemService.exportItems.mockResolvedValue(mockExportResponse);

      const result = await controller.exportItems(request);

      expect(result.content).toContain('RESEARCH SCRATCHPAD');
      expect(result.filename).toMatch(/\.txt$/);
    });

    it('should export items as JSON', async () => {
      const request: ExportRequest = {
        workspaceId: 'workspace-123',
        format: 'json',
      };

      const mockExportResponse = {
        content: '{"generated":"2026-02-03T10:00:00.000Z","totalCount":2,"items":[]}',
        filename: 'scratchpad-1234567890.json',
      };

      mockScratchpadItemService.exportItems.mockResolvedValue(mockExportResponse);

      const result = await controller.exportItems(request);

      expect(result.filename).toMatch(/\.json$/);
      const parsed = JSON.parse(result.content);
      expect(parsed).toHaveProperty('generated');
      expect(parsed).toHaveProperty('totalCount');
      expect(parsed).toHaveProperty('items');
    });

    it('should export only specified items when itemIds provided', async () => {
      const request: ExportRequest = {
        workspaceId: 'workspace-123',
        format: 'markdown',
        itemIds: ['item-1', 'item-2'],
      };

      const mockExportResponse = {
        content: '# Research Scratchpad\n\nTotal Items: 2\n\n...',
        filename: 'scratchpad-1234567890.md',
      };

      mockScratchpadItemService.exportItems.mockResolvedValue(mockExportResponse);

      const result = await controller.exportItems(request);

      expect(service.exportItems).toHaveBeenCalledWith(request);
      expect(result.content).toContain('Total Items: 2');
    });
  });
});
