/**
 * Unit Tests for ChatService Tenant Isolation
 * 
 * These tests verify complete tenant isolation for chat operations:
 * - sendMessage verifies session belongs to tenant-owned deal
 * - getConversationHistory filters by tenant-owned deals
 * - clearConversationHistory verifies session ownership
 * - Cross-tenant chat access returns 404
 * 
 * SECURITY FOCUS: Chat sessions inherit tenant ownership from their parent deal.
 * All operations must verify the session's deal belongs to the current tenant.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { ChatService } from '../../src/deals/chat.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RAGService } from '../../src/rag/rag.service';
import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';
import { MarketDataService } from '../../src/deals/market-data.service';
import { TENANT_CONTEXT_KEY, TenantContext } from '../../src/tenant/tenant-context';

describe('ChatService - Tenant Isolation', () => {
  let service: ChatService;
  let prismaService: jest.Mocked<PrismaService>;
  let ragService: jest.Mocked<RAGService>;
  let mockRequest: any;

  // Test tenant IDs
  const tenantA = 'tenant-a-uuid-1234';
  const tenantB = 'tenant-b-uuid-5678';
  const userId = 'user-uuid-9999';

  // Helper to create tenant context
  const createTenantContext = (tenantId: string): TenantContext => ({
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

  // Sample data
  const dealTenantA = {
    id: 'deal-a-uuid',
    tenantId: tenantA,
    name: 'Apple Analysis',
    ticker: 'AAPL',
  };

  const dealTenantB = {
    id: 'deal-b-uuid',
    tenantId: tenantB,
    name: 'Microsoft Analysis',
    ticker: 'MSFT',
  };

  const sessionTenantA = {
    id: 'session-a-uuid',
    dealId: dealTenantA.id,
    systemPrompt: 'You are a financial analyst.',
    createdAt: new Date(),
    updatedAt: new Date(),
    deal: dealTenantA,
  };

  const sessionTenantB = {
    id: 'session-b-uuid',
    dealId: dealTenantB.id,
    systemPrompt: 'Confidential analysis.',
    createdAt: new Date(),
    updatedAt: new Date(),
    deal: dealTenantB,
  };

  beforeEach(async () => {
    // Default to Tenant A context
    mockRequest = {
      [TENANT_CONTEXT_KEY]: createTenantContext(tenantA),
    };

    const mockPrismaService = {
      analysisSession: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      deal: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      chatMessage: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $queryRawUnsafe: jest.fn(),
    };

    const mockRAGService = {
      query: jest.fn().mockResolvedValue({
        answer: 'AI response',
        sources: [],
        usage: { inputTokens: 100, outputTokens: 50 },
        intent: { confidence: 0.95 },
        processingInfo: {},
        latency: 100,
      }),
    };

    const mockFinancialCalculatorService = {
      getMetricsSummary: jest.fn().mockResolvedValue(null),
    };

    const mockMarketDataService = {
      getStockQuote: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RAGService, useValue: mockRAGService },
        { provide: FinancialCalculatorService, useValue: mockFinancialCalculatorService },
        { provide: MarketDataService, useValue: mockMarketDataService },
        { provide: REQUEST, useValue: mockRequest },
      ],
    }).compile();

    service = await module.resolve<ChatService>(ChatService);
    prismaService = module.get(PrismaService);
    ragService = module.get(RAGService);
  });


  describe('sendMessage', () => {
    it('should send message when session belongs to tenant-owned deal (Req 3.2)', async () => {
      // Session belongs to tenant A's deal
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantA);
      (prismaService.chatMessage.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaService.chatMessage.create as jest.Mock).mockImplementation(({ data }) => 
        Promise.resolve({
          id: 'msg-uuid',
          ...data,
          createdAt: new Date(),
        })
      );
      (prismaService.deal.findUnique as jest.Mock).mockResolvedValue(dealTenantA);

      const result = await service.sendMessage({
        content: 'What is Apple revenue?',
        sessionId: sessionTenantA.id,
      });

      expect(result.userMessage).toBeDefined();
      expect(result.assistantMessage).toBeDefined();
      expect(prismaService.analysisSession.findUnique).toHaveBeenCalledWith({
        where: { id: sessionTenantA.id },
        include: { deal: true },
      });
    });

    it('should throw 404 when session belongs to another tenant deal (Req 3.6)', async () => {
      // Tenant A tries to access Tenant B's session
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      await expect(service.sendMessage({
        content: 'Trying to access secret data',
        sessionId: sessionTenantB.id,
      })).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 when session does not exist', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.sendMessage({
        content: 'Hello',
        sessionId: 'non-existent-session',
      })).rejects.toThrow(NotFoundException);
    });

    it('should return 404 NOT 403 to prevent information leakage', async () => {
      // Tenant A tries to access Tenant B's session
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      try {
        await service.sendMessage({
          content: 'Trying to access secret data',
          sessionId: sessionTenantB.id,
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toBe('Session not found');
        expect(error.getStatus()).toBe(404);
        // Verify it's NOT a ForbiddenException (403)
        expect(error.getStatus()).not.toBe(403);
      }
    });
  });

  describe('getConversationHistory', () => {
    it('should return messages for tenant-owned deal (Req 3.3)', async () => {
      // Deal belongs to tenant A
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(dealTenantA);
      (prismaService.chatMessage.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          sources: '[]',
          createdAt: new Date(),
          tokensUsed: 10,
          metadata: {},
          session: sessionTenantA,
        },
        {
          id: 'msg-2',
          role: 'assistant',
          content: 'Hi there!',
          sources: '[]',
          createdAt: new Date(),
          tokensUsed: 20,
          metadata: {},
          session: sessionTenantA,
        },
      ]);

      const result = await service.getConversationHistory(dealTenantA.id);

      expect(result).toHaveLength(2);
      expect(prismaService.deal.findFirst).toHaveBeenCalledWith({
        where: {
          id: dealTenantA.id,
          tenantId: tenantA,
        },
      });
    });

    it('should throw 404 when deal belongs to another tenant', async () => {
      // Deal not found for tenant A (belongs to tenant B)
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getConversationHistory(dealTenantB.id))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should return empty array when deal has no messages', async () => {
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(dealTenantA);
      (prismaService.chatMessage.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getConversationHistory(dealTenantA.id);

      expect(result).toHaveLength(0);
    });
  });

  describe('clearConversationHistory', () => {
    it('should clear history when session belongs to tenant-owned deal (Req 3.4)', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantA);
      (prismaService.chatMessage.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

      await service.clearConversationHistory(sessionTenantA.id);

      expect(prismaService.chatMessage.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: sessionTenantA.id },
      });
    });

    it('should throw 404 when session belongs to another tenant deal', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      await expect(service.clearConversationHistory(sessionTenantB.id))
        .rejects
        .toThrow(NotFoundException);

      // Verify delete was never called
      expect(prismaService.chatMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('should throw 404 when session does not exist', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.clearConversationHistory('non-existent'))
        .rejects
        .toThrow(NotFoundException);
    });
  });

  describe('getSessionById', () => {
    it('should return session when it belongs to tenant-owned deal', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantA);

      const result = await service.getSessionById(sessionTenantA.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(sessionTenantA.id);
      expect(result?.dealId).toBe(dealTenantA.id);
    });

    it('should return null when session belongs to another tenant deal', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      const result = await service.getSessionById(sessionTenantB.id);

      expect(result).toBeNull();
    });

    it('should return null when session does not exist', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getSessionById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('updateSystemPrompt', () => {
    it('should update prompt when session belongs to tenant-owned deal', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantA);
      (prismaService.analysisSession.update as jest.Mock).mockResolvedValue({
        ...sessionTenantA,
        systemPrompt: 'New prompt',
      });
      (prismaService.chatMessage.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaService.chatMessage.create as jest.Mock).mockResolvedValue({
        id: 'system-msg',
        role: 'system',
        content: 'New prompt',
      });

      await service.updateSystemPrompt(sessionTenantA.id, 'New prompt');

      expect(prismaService.analysisSession.update).toHaveBeenCalledWith({
        where: { id: sessionTenantA.id },
        data: { systemPrompt: 'New prompt' },
      });
    });

    it('should throw 404 when session belongs to another tenant deal', async () => {
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      await expect(service.updateSystemPrompt(sessionTenantB.id, 'Hacked prompt'))
        .rejects
        .toThrow(NotFoundException);

      // Verify update was never called
      expect(prismaService.analysisSession.update).not.toHaveBeenCalled();
    });
  });

  describe('getChatStats', () => {
    it('should return stats only for tenant-owned deals', async () => {
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(dealTenantA);
      (prismaService.$queryRawUnsafe as jest.Mock).mockResolvedValue([{
        total_messages: '10',
        total_sessions: '2',
        avg_messages_per_session: '5',
        total_tokens_used: '1000',
      }]);

      const result = await service.getChatStats(dealTenantA.id);

      expect(result.totalMessages).toBe(10);
      expect(result.totalSessions).toBe(2);
      
      // Verify query includes tenant filter
      const queryCall = (prismaService.$queryRawUnsafe as jest.Mock).mock.calls[0][0];
      expect(queryCall).toContain(`tenant_id = '${tenantA}'`);
    });

    it('should throw 404 when deal belongs to another tenant', async () => {
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getChatStats(dealTenantB.id))
        .rejects
        .toThrow(NotFoundException);
    });
  });


  describe('Cross-Tenant Attack Prevention', () => {
    it('should prevent tenant A from sending messages to tenant B sessions', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      await expect(service.sendMessage({
        content: 'Malicious message',
        sessionId: sessionTenantB.id,
      })).rejects.toThrow(NotFoundException);
    });

    it('should prevent tenant A from viewing tenant B conversation history', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      (prismaService.deal.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getConversationHistory(dealTenantB.id))
        .rejects
        .toThrow(NotFoundException);
    });

    it('should prevent tenant A from clearing tenant B conversation history', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      await expect(service.clearConversationHistory(sessionTenantB.id))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.chatMessage.deleteMany).not.toHaveBeenCalled();
    });

    it('should prevent tenant A from updating tenant B system prompts', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      await expect(service.updateSystemPrompt(sessionTenantB.id, 'Hacked'))
        .rejects
        .toThrow(NotFoundException);

      expect(prismaService.analysisSession.update).not.toHaveBeenCalled();
    });

    it('should prevent session ID guessing attacks', async () => {
      mockRequest[TENANT_CONTEXT_KEY] = createTenantContext(tenantA);
      
      // Attacker guesses a valid session ID that belongs to tenant B
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionTenantB);

      await expect(service.sendMessage({
        content: 'Guessed your session!',
        sessionId: sessionTenantB.id,
      })).rejects.toThrow(NotFoundException);
    });
  });

  describe('Chat Session Tenant Inheritance (Req 3.1)', () => {
    it('should verify session inherits tenant from parent deal', async () => {
      // Session's deal has tenant A
      const sessionWithDeal = {
        ...sessionTenantA,
        deal: { ...dealTenantA, tenantId: tenantA },
      };
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionWithDeal);
      (prismaService.chatMessage.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaService.chatMessage.create as jest.Mock).mockImplementation(({ data }) => 
        Promise.resolve({ id: 'msg', ...data, createdAt: new Date() })
      );
      (prismaService.deal.findUnique as jest.Mock).mockResolvedValue(dealTenantA);

      // Should succeed because session's deal belongs to tenant A
      const result = await service.sendMessage({
        content: 'Test',
        sessionId: sessionTenantA.id,
      });

      expect(result).toBeDefined();
    });

    it('should reject session when parent deal belongs to different tenant', async () => {
      // Session's deal has tenant B, but current context is tenant A
      const sessionWithWrongTenant = {
        ...sessionTenantA,
        deal: { ...dealTenantA, tenantId: tenantB }, // Wrong tenant!
      };
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionWithWrongTenant);

      await expect(service.sendMessage({
        content: 'Test',
        sessionId: sessionTenantA.id,
      })).rejects.toThrow(NotFoundException);
    });
  });

  describe('Backward Compatibility', () => {
    it('should use default tenant when no context available', async () => {
      // Remove tenant context
      mockRequest[TENANT_CONTEXT_KEY] = undefined;

      // Session with default tenant
      const sessionDefaultTenant = {
        ...sessionTenantA,
        deal: { ...dealTenantA, tenantId: 'default-tenant' },
      };
      (prismaService.analysisSession.findUnique as jest.Mock).mockResolvedValue(sessionDefaultTenant);
      (prismaService.chatMessage.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaService.chatMessage.create as jest.Mock).mockImplementation(({ data }) => 
        Promise.resolve({ id: 'msg', ...data, createdAt: new Date() })
      );
      (prismaService.deal.findUnique as jest.Mock).mockResolvedValue({
        ...dealTenantA,
        tenantId: 'default-tenant',
      });

      // Should work with default tenant
      const result = await service.sendMessage({
        content: 'Test',
        sessionId: sessionTenantA.id,
      });

      expect(result).toBeDefined();
    });
  });
});
