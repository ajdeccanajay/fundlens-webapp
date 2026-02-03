/**
 * Unit Tests for NotebookService
 * 
 * Tests notebook and insight management with full tenant isolation.
 * 
 * Coverage:
 * - Notebook CRUD operations
 * - Insight management
 * - Tenant isolation
 * - User isolation
 * - Reordering
 * - Export functionality
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { NotebookService } from '../../src/research/notebook.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContext } from '../../src/tenant/tenant-context';

describe('NotebookService', () => {
  let service: NotebookService;
  let prisma: PrismaService;
  let mockRequest: any;

  const tenantId = 'tenant-123';
  const userId = 'user-456';
  const otherTenantId = 'other-tenant-789';
  const otherUserId = 'other-user-012';

  beforeEach(async () => {
    // Mock request with tenant context
    mockRequest = {
      tenantContext: {
        tenantId,
        userId,
      } as TenantContext,
    };

    // Mock PrismaService
    const mockPrisma = {
      researchNotebook: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
      researchInsight: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotebookService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: REQUEST,
          useValue: mockRequest,
        },
      ],
    }).compile();

    // Use resolve() for request-scoped providers
    service = await module.resolve<NotebookService>(NotebookService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Notebook CRUD', () => {
    it('should create notebook with tenant_id from context', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
        title: 'My Research',
        description: 'Test notebook',
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { insights: 0 },
      };

      (prisma.researchNotebook.create as jest.Mock).mockResolvedValue(mockNotebook);

      const result = await service.createNotebook({
        title: 'My Research',
        description: 'Test notebook',
      });

      expect(prisma.researchNotebook.create).toHaveBeenCalledWith({
        data: {
          tenantId,
          userId,
          title: 'My Research',
          description: 'Test notebook',
        },
        include: {
          _count: {
            select: { insights: true },
          },
        },
      });

      expect(result.id).toBe('notebook-1');
      expect(result.tenantId).toBe(tenantId);
      expect(result.userId).toBe(userId);
    });

    it('should list notebooks for current tenant/user', async () => {
      const mockNotebooks = [
        {
          id: 'notebook-1',
          tenantId,
          userId,
          title: 'Notebook 1',
          description: null,
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { insights: 3 },
        },
        {
          id: 'notebook-2',
          tenantId,
          userId,
          title: 'Notebook 2',
          description: null,
          isArchived: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { insights: 5 },
        },
      ];

      (prisma.researchNotebook.findMany as jest.Mock).mockResolvedValue(mockNotebooks);
      (prisma.researchNotebook.count as jest.Mock).mockResolvedValue(2);

      const result = await service.listNotebooks();

      expect(prisma.researchNotebook.findMany).toHaveBeenCalledWith({
        where: { tenantId, userId },
        include: {
          _count: {
            select: { insights: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        skip: 0,
      });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter archived notebooks', async () => {
      (prisma.researchNotebook.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.researchNotebook.count as jest.Mock).mockResolvedValue(0);

      await service.listNotebooks({ archived: true });

      expect(prisma.researchNotebook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId, userId, isArchived: true },
        })
      );
    });

    it('should support pagination', async () => {
      (prisma.researchNotebook.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.researchNotebook.count as jest.Mock).mockResolvedValue(100);

      const result = await service.listNotebooks({ limit: 10, offset: 20 });

      expect(prisma.researchNotebook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        })
      );

      expect(result.pagination.hasMore).toBe(true);
    });

    it('should get notebook by ID with insights', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
        title: 'My Notebook',
        description: null,
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        insights: [
          {
            id: 'insight-1',
            notebookId: 'notebook-1',
            messageId: null,
            content: 'Insight content',
            selectedText: null,
            userNotes: null,
            tags: [],
            companies: [],
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);

      const result = await service.getNotebook('notebook-1');

      expect(prisma.researchNotebook.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'notebook-1',
          tenantId,
          userId,
        },
        include: {
          insights: {
            orderBy: { position: 'asc' },
          },
        },
      });

      expect(result.notebook.id).toBe('notebook-1');
      expect(result.insights).toHaveLength(1);
    });

    it('should throw NotFoundException for non-existent notebook', async () => {
      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getNotebook('non-existent')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should update notebook', async () => {
      const mockExisting = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      const mockUpdated = {
        id: 'notebook-1',
        tenantId,
        userId,
        title: 'Updated Title',
        description: 'Updated description',
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { insights: 2 },
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockExisting);
      (prisma.researchNotebook.update as jest.Mock).mockResolvedValue(mockUpdated);

      const result = await service.updateNotebook('notebook-1', {
        title: 'Updated Title',
        description: 'Updated description',
      });

      expect(result.title).toBe('Updated Title');
    });

    it('should delete notebook', async () => {
      const mockExisting = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockExisting);
      (prisma.researchNotebook.delete as jest.Mock).mockResolvedValue(mockExisting);

      const result = await service.deleteNotebook('notebook-1');

      expect(result.success).toBe(true);
      expect(prisma.researchNotebook.delete).toHaveBeenCalledWith({
        where: { id: 'notebook-1' },
      });
    });
  });

  describe('Insight Management', () => {
    it('should add insight to notebook', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      const mockMaxPosition = {
        position: 2,
      };

      const mockInsight = {
        id: 'insight-1',
        notebookId: 'notebook-1',
        messageId: null,
        content: 'New insight',
        selectedText: null,
        userNotes: 'My notes',
        tags: ['tag1', 'tag2'],
        companies: ['AAPL', 'MSFT'],
        position: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);
      (prisma.researchInsight.findFirst as jest.Mock).mockResolvedValue(mockMaxPosition);
      (prisma.researchInsight.create as jest.Mock).mockResolvedValue(mockInsight);
      (prisma.researchNotebook.update as jest.Mock).mockResolvedValue({});

      const result = await service.addInsight('notebook-1', {
        content: 'New insight',
        userNotes: 'My notes',
        tags: ['tag1', 'tag2'],
        companies: ['AAPL', 'MSFT'],
      });

      expect(result.position).toBe(3);
      expect(result.tags).toEqual(['tag1', 'tag2']);
      expect(result.companies).toEqual(['AAPL', 'MSFT']);
    });

    it('should set position to 0 for first insight', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);
      (prisma.researchInsight.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.researchInsight.create as jest.Mock).mockResolvedValue({
        id: 'insight-1',
        position: 0,
        tags: [],
        companies: [],
      });
      (prisma.researchNotebook.update as jest.Mock).mockResolvedValue({});

      const result = await service.addInsight('notebook-1', {
        content: 'First insight',
      });

      expect(result.position).toBe(0);
    });

    it('should update insight', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      const mockExisting = {
        id: 'insight-1',
        notebookId: 'notebook-1',
      };

      const mockUpdated = {
        id: 'insight-1',
        notebookId: 'notebook-1',
        messageId: null,
        content: 'Updated content',
        selectedText: null,
        userNotes: 'Updated notes',
        tags: ['new-tag'],
        companies: ['GOOGL'],
        position: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);
      (prisma.researchInsight.findFirst as jest.Mock).mockResolvedValue(mockExisting);
      (prisma.researchInsight.update as jest.Mock).mockResolvedValue(mockUpdated);
      (prisma.researchNotebook.update as jest.Mock).mockResolvedValue({});

      const result = await service.updateInsight('notebook-1', 'insight-1', {
        content: 'Updated content',
        userNotes: 'Updated notes',
        tags: ['new-tag'],
        companies: ['GOOGL'],
      });

      expect(result.content).toBe('Updated content');
      expect(result.tags).toEqual(['new-tag']);
    });

    it('should delete insight', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      const mockExisting = {
        id: 'insight-1',
        notebookId: 'notebook-1',
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);
      (prisma.researchInsight.findFirst as jest.Mock).mockResolvedValue(mockExisting);
      (prisma.researchInsight.delete as jest.Mock).mockResolvedValue(mockExisting);
      (prisma.researchNotebook.update as jest.Mock).mockResolvedValue({});

      const result = await service.deleteInsight('notebook-1', 'insight-1');

      expect(result.success).toBe(true);
      expect(prisma.researchInsight.delete).toHaveBeenCalledWith({
        where: { id: 'insight-1' },
      });
    });

    it('should throw NotFoundException for non-existent insight', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);
      (prisma.researchInsight.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateInsight('notebook-1', 'non-existent', { content: 'test' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Tenant Isolation', () => {
    it('should return only current tenant notebooks', async () => {
      (prisma.researchNotebook.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.researchNotebook.count as jest.Mock).mockResolvedValue(0);

      await service.listNotebooks();

      expect(prisma.researchNotebook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId }),
        })
      );
    });

    it('should not allow access to other tenant notebook', async () => {
      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getNotebook('other-tenant-notebook')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should not allow updating other tenant notebook', async () => {
      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateNotebook('other-tenant-notebook', { title: 'Hacked' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should not allow deleting other tenant notebook', async () => {
      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteNotebook('other-tenant-notebook')).rejects.toThrow(
        NotFoundException
      );
    });

    it('should not allow adding insight to other tenant notebook', async () => {
      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addInsight('other-tenant-notebook', { content: 'test' })
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('User Isolation', () => {
    it('should return only current user notebooks', async () => {
      (prisma.researchNotebook.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.researchNotebook.count as jest.Mock).mockResolvedValue(0);

      await service.listNotebooks();

      expect(prisma.researchNotebook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId }),
        })
      );
    });

    it('should not allow access to other user notebook (same tenant)', async () => {
      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getNotebook('other-user-notebook')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('Reordering', () => {
    it('should reorder insights', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      const mockInsights = [
        { id: 'insight-1', notebookId: 'notebook-1' },
        { id: 'insight-2', notebookId: 'notebook-1' },
        { id: 'insight-3', notebookId: 'notebook-1' },
      ];

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);
      (prisma.researchInsight.findMany as jest.Mock).mockResolvedValue(mockInsights);
      (prisma.researchInsight.update as jest.Mock).mockResolvedValue({});
      (prisma.researchNotebook.update as jest.Mock).mockResolvedValue({});

      const result = await service.reorderInsights('notebook-1', [
        'insight-3',
        'insight-1',
        'insight-2',
      ]);

      expect(result.success).toBe(true);
      expect(prisma.researchInsight.update).toHaveBeenCalledTimes(3);
      expect(prisma.researchInsight.update).toHaveBeenCalledWith({
        where: { id: 'insight-3' },
        data: { position: 0 },
      });
      expect(prisma.researchInsight.update).toHaveBeenCalledWith({
        where: { id: 'insight-1' },
        data: { position: 1 },
      });
      expect(prisma.researchInsight.update).toHaveBeenCalledWith({
        where: { id: 'insight-2' },
        data: { position: 2 },
      });
    });

    it('should throw error if insight does not belong to notebook', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
      };

      const mockInsights = [
        { id: 'insight-1', notebookId: 'notebook-1' },
      ];

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);
      (prisma.researchInsight.findMany as jest.Mock).mockResolvedValue(mockInsights);

      await expect(
        service.reorderInsights('notebook-1', ['insight-1', 'insight-2'])
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Export', () => {
    it('should export notebook as Markdown', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
        title: 'My Research',
        description: 'Test notebook',
        isArchived: false,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        insights: [
          {
            id: 'insight-1',
            notebookId: 'notebook-1',
            messageId: null,
            content: 'First insight',
            selectedText: 'Selected text',
            userNotes: 'My notes',
            tags: ['tag1', 'tag2'],
            companies: ['AAPL', 'MSFT'],
            position: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'insight-2',
            notebookId: 'notebook-1',
            messageId: null,
            content: 'Second insight',
            selectedText: null,
            userNotes: null,
            tags: [],
            companies: [],
            position: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);

      const markdown = await service.exportMarkdown('notebook-1');

      expect(markdown).toContain('# My Research');
      expect(markdown).toContain('Test notebook');
      expect(markdown).toContain('First insight');
      expect(markdown).toContain('Second insight');
      expect(markdown).toContain('> Selected text');
      expect(markdown).toContain('**Notes**: My notes');
      expect(markdown).toContain('**Tags**: tag1, tag2');
      expect(markdown).toContain('**Companies**: AAPL, MSFT');
    });

    it('should handle notebook without description', async () => {
      const mockNotebook = {
        id: 'notebook-1',
        tenantId,
        userId,
        title: 'My Research',
        description: null,
        isArchived: false,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        insights: [],
      };

      (prisma.researchNotebook.findFirst as jest.Mock).mockResolvedValue(mockNotebook);

      const markdown = await service.exportMarkdown('notebook-1');

      expect(markdown).toContain('# My Research');
      expect(markdown).not.toContain('null');
    });
  });
});
