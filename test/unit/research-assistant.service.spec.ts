/**
 * Unit Tests for ResearchAssistantService
 * 
 * Tests tenant isolation, conversation management, and streaming responses.
 * Follows the same patterns as deal.service.spec.ts for consistency.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import {
  ResearchAssistantService,
  CreateConversationDto,
  SendMessageDto,
} from '../../src/research/research-assistant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RAGService } from '../../src/rag/rag.service';
import { TENANT_CONTEXT_KEY, TenantContext } from '../../src/tenant/tenant-context';

describe('ResearchAssistantService - Tenant Isolation', () => {
  let service: ResearchAssistantService;
  let prismaService: jest.Mocked<PrismaService>;
  let ragService: jest.Mocked<RAGService>;
  let mockRequest: any;

  // Test tenant IDs
  const tenantA = 'tenant-a-uuid-1234';
  const tenantB = 'tenant-b-uuid-5678';
  const userA = 'user-a-uuid-9999';
  const userB = 'user-b-uuid-8888';

  // Helper to create tenant context
  const createTenantContext = (tenantId: string, userId: string): TenantContext => ({
    tenantId,
    tenantSlug: `tenant-${tenantId.slice(0, 8)}`,
    tenantTier: 'pro',
    userId,
    userEmail: 'test@example.com',
    userRole: 'analyst',
    permissions: {
      canCreateDeals: true,
      canDeleteDeals: true,
      canUploadDocuments: true,
      canManageUsers: false,
      canViewAuditLogs: false,
      canExportData: true,
      maxDeals: 50,
      maxUploadsGB: 10,
    },
  });

  // Sample conversation data
  const sampleConversationTenantA = {
    id: 'conv-1-uuid',
    tenantId: tenantA,
    userId: userA,
    title: 'Apple vs Microsoft Analysis',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lastMessageAt: new Date('2024-01-01'),
    isPinned: false,
    isArchived: false,
    messageCount: 5,
  };

  const sampleConversationTenantB = {
    id: 'conv-2-uuid',
    tenantId: tenantB,
    userId: userB,
    title: 'Confidential Research',
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
    lastMessageAt: new Date('2024-01-02'),
    isPinned: true,
    isArchived: false,
    messageCount: 10,
  };

  const sampleMessage = {
    id: 'msg-1-uuid',
    conversationId: 'conv-1-uuid',
    role: 'user',
    content: 'What is AAPL revenue?',
    sources: [],
    metadata: {},
    tokensUsed: 0,
    createdAt: new Date('2024-01-01'),
  };

  beforeEach(async () => {
    // Default to Tenant A context
    mockRequest = {
      [TENANT_CONTEXT_KEY]: createTenantContext(tenantA, userA),
    };

    const mockPrismaService = {
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    const mockRAGService = {
      query: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchAssistantService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: RAGService,
          useValue: mockRAGService,
        },
        {
          provide: REQUEST,
          useValue: mockRequest,
        },
      ],
    }).compile();

    service = await module.resolve<ResearchAssistantService>(ResearchAssistantService);
    prismaService = module.get(PrismaService);
    ragService = module.get(RAGService);
  });

  describe('createConversation', () => {
    it('should create conversation with tenant_id from context', async () => {
      const dto: CreateConversationDto = {
        title: 'New Research',
      };

      const newConversation = { ...sampleConversationTenantA, title: 'New Research' };
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([newConversation]);

      const result = await service.createConversation(dto);

      expect(result.tenantId).toBe(tenantA);
      expect(result.userId).toBe(userA);
      expect(result.title).toBe('New Research');
      expect(prismaService.$queryRaw).toHaveBeenCalled();
    });

    it('should generate default title if not provided', async () => {
      const dto: CreateConversationDto = {};

      const defaultTitleConv = { ...sampleConversationTenantA, title: 'Research 1/26/2026' };
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([defaultTitleConv]);

      const result = await service.createConversation(dto);

      expect(result.title).toMatch(/Research/);
    });

    it('should NOT allow tenant_id to be injected', async () => {
      const dto: CreateConversationDto = {
        title: 'Malicious Research',
      };

      // Even if someone tries to inject tenant_id, it should use context
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([sampleConversationTenantA]);

      const result = await service.createConversation(dto);

      expect(result.tenantId).toBe(tenantA);
    });
  });

  describe('getConversations', () => {
    it('should return only conversations for current tenant/user', async () => {
      (prismaService.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([sampleConversationTenantA])
        .mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.getConversations();

      expect(result.conversations).toHaveLength(1);
      expect(result.conversations[0].id).toBe(sampleConversationTenantA.id);
      expect(result.total).toBe(1);
    });

    it('should NOT return conversations from other tenants', async () => {
      (prismaService.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([sampleConversationTenantA])
        .mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.getConversations();

      expect(result.conversations.find(c => c.id === sampleConversationTenantB.id)).toBeUndefined();
    });

    it('should filter by archived status', async () => {
      (prismaService.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      const result = await service.getConversations({ archived: true });

      expect(result.conversations).toHaveLength(0);
      expect(prismaService.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_archived = true'),
      );
    });

    it('should filter by pinned status', async () => {
      (prismaService.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ count: 0 }]);

      const result = await service.getConversations({ pinned: true });

      expect(prismaService.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_pinned = true'),
      );
    });

    it('should support pagination', async () => {
      (prismaService.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([sampleConversationTenantA])
        .mockResolvedValueOnce([{ count: 100 }]);

      const result = await service.getConversations({ limit: 10, offset: 20 });

      expect(result.hasMore).toBe(true);
      expect(prismaService.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT 10'),
      );
    });
  });

  describe('getConversation', () => {
    it('should return conversation with messages when owned by tenant', async () => {
      (prismaService.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([sampleConversationTenantA])
        .mockResolvedValueOnce([sampleMessage]);

      const result = await service.getConversation('conv-1-uuid');

      expect(result.conversation.id).toBe('conv-1-uuid');
      expect(result.messages).toHaveLength(1);
    });

    it('should throw 404 when conversation belongs to another tenant', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getConversation('conv-2-uuid'))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should throw 404 when conversation does not exist', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getConversation('non-existent-uuid'))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should return 404 NOT 403 to prevent information leakage', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      try {
        await service.getConversation('secret-conv-uuid');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Conversation not found');
        expect(error.getStatus()).toBe(404);
        expect(error.getStatus()).not.toBe(403);
      }
    });
  });

  describe('updateConversation', () => {
    it('should update conversation when owned by tenant', async () => {
      (prismaService.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ count: 1 }]) // ownership verification
        .mockResolvedValueOnce([{ ...sampleConversationTenantA, title: 'Updated Title' }])
        .mockResolvedValueOnce([]); // messages

      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue(1);

      const result = await service.updateConversation('conv-1-uuid', {
        title: 'Updated Title',
      });

      expect(prismaService.$queryRawUnsafe).toHaveBeenCalled();
    });

    it('should throw 404 when updating another tenant conversation', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{ count: 0 }]);

      await expect(service.updateConversation('conv-2-uuid', { title: 'Hacked' }))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should update isPinned flag', async () => {
      (prismaService.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ ...sampleConversationTenantA, isPinned: true }])
        .mockResolvedValueOnce([]);

      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue(1);

      await service.updateConversation('conv-1-uuid', { isPinned: true });

      expect(prismaService.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_pinned = true'),
      );
    });

    it('should update isArchived flag', async () => {
      (prismaService.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ count: 1 }])
        .mockResolvedValueOnce([{ ...sampleConversationTenantA, isArchived: true }])
        .mockResolvedValueOnce([]);

      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue(1);

      await service.updateConversation('conv-1-uuid', { isArchived: true });

      expect(prismaService.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('is_archived = true'),
      );
    });
  });

  describe('deleteConversation', () => {
    it('should delete conversation when owned by tenant', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{ count: 1 }]);
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(1);

      await service.deleteConversation('conv-1-uuid');

      expect(prismaService.$executeRaw).toHaveBeenCalled();
    });

    it('should throw 404 when deleting another tenant conversation', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{ count: 0 }]);

      await expect(service.deleteConversation('conv-2-uuid'))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('should throw 404 if deletion returns 0 rows', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{ count: 1 }]);
      (prismaService.$executeRaw as jest.Mock).mockResolvedValue(0);

      await expect(service.deleteConversation('conv-1-uuid'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('sendMessage', () => {
    it('should stream response with tenant-aware RAG', async () => {
      const dto: SendMessageDto = {
        content: 'What is AAPL revenue?',
      };

      // Mock ownership verification
      (prismaService.$queryRaw as jest.Mock)
        .mockResolvedValueOnce([{ count: 1 }]) // ownership
        .mockResolvedValueOnce([sampleMessage]) // save user message
        .mockResolvedValueOnce([{ ...sampleMessage, role: 'assistant' }]); // save assistant message

      // Mock RAG service with full hybrid response
      (ragService.query as jest.Mock).mockResolvedValue({
        answer: 'Apple revenue for FY2024 was $385.6B.',
        intent: { type: 'structured', ticker: 'AAPL', metrics: ['Revenue'] },
        metrics: [{ ticker: 'AAPL', normalizedMetric: 'Revenue', value: 385600000000 }],
        narratives: [],
        sources: [{ type: 'metric', ticker: 'AAPL', filingType: '10-K' }],
        timestamp: new Date(),
        latency: 150,
        cost: 0.001,
        usage: { inputTokens: 100, outputTokens: 50 },
        processingInfo: {
          structuredMetrics: 1,
          semanticNarratives: 0,
          usedBedrockKB: false,
          usedClaudeGeneration: false,
          hybridProcessing: true,
        },
      });

      const stream = service.sendMessage('conv-1-uuid', dto);
      const chunks: any[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Should have token chunks and done chunk
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[chunks.length - 1].type).toBe('done');
      expect(ragService.query).toHaveBeenCalled();
    });

    it('should extract tickers from query', () => {
      const tickers = service.extractTickers('Compare AAPL and MSFT revenue');
      expect(tickers).toContain('AAPL');
      expect(tickers).toContain('MSFT');
    });

    it('should filter out common words that look like tickers', () => {
      const tickers = service.extractTickers('I want to analyze US companies');
      expect(tickers).not.toContain('I');
      expect(tickers).not.toContain('US');
    });

    it('should use provided tickers from context', () => {
      const tickers = service.extractTickers('Compare revenue', ['GOOGL', 'META']);
      expect(tickers).toContain('GOOGL');
      expect(tickers).toContain('META');
    });

    it('should yield error chunk when conversation not owned by tenant', async () => {
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{ count: 0 }]);

      const dto: SendMessageDto = {
        content: 'Hacking attempt',
      };

      const stream = service.sendMessage('conv-2-uuid', dto);
      const chunks: any[] = [];

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // Should have received an error chunk
      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].type).toBe('error');
      expect(chunks[0].data.message).toContain('Conversation not found');
    });
  });

  describe('Cross-Tenant Attack Prevention', () => {
    it('should prevent tenant A from accessing tenant B conversations', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA, userA);
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getConversation(sampleConversationTenantB.id))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should prevent tenant A from updating tenant B conversations', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA, userA);
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{ count: 0 }]);

      await expect(service.updateConversation(sampleConversationTenantB.id, { title: 'Hacked' }))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('should prevent tenant A from deleting tenant B conversations', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA, userA);
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([{ count: 0 }]);

      await expect(service.deleteConversation(sampleConversationTenantB.id))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.$executeRaw).not.toHaveBeenCalled();
    });

    it('should prevent SQL injection in conversation ID', async () => {
      const maliciousId = "'; DROP TABLE research_conversations; --";
      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getConversation(maliciousId))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('User Isolation', () => {
    it('should only return conversations for current user', async () => {
      // User A should not see User B's conversations in same tenant
      (prismaService.$queryRawUnsafe as jest.Mock)
        .mockResolvedValueOnce([sampleConversationTenantA])
        .mockResolvedValueOnce([{ count: 1 }]);

      const result = await service.getConversations();

      expect(result.conversations.every(c => c.userId === userA)).toBe(true);
    });

    it('should throw 404 when accessing another user conversation in same tenant', async () => {
      const otherUserConv = {
        ...sampleConversationTenantA,
        id: 'other-user-conv',
        userId: 'other-user-uuid',
      };

      (prismaService.$queryRaw as jest.Mock).mockResolvedValue([]);

      await expect(service.getConversation(otherUserConv.id))
        .rejects
        .toThrow(NotFoundException);
    });
  });
});
