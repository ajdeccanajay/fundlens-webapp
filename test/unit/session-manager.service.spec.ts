/**
 * Unit Tests for SessionManager Service
 * 
 * Tests session lifecycle, rate limiting, and timeout handling
 * Requirements: 1.7, 1.8, 1.9, 11.1, 11.4, 13.1, 13.2
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionManagerService, SessionState, CreateSessionParams } from '../../src/instant-rag/session-manager.service';
import { RateLimitException } from '../../src/instant-rag/rate-limit.exception';
import { PrismaService } from '../../prisma/prisma.service';

describe('SessionManagerService', () => {
  let service: SessionManagerService;
  let prisma: jest.Mocked<PrismaService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDealId = '22222222-2222-2222-2222-222222222222';
  const mockUserId = '33333333-3333-3333-3333-333333333333';
  const mockSessionId = '44444444-4444-4444-4444-444444444444';

  const mockSession: SessionState = {
    id: mockSessionId,
    tenantId: mockTenantId,
    dealId: mockDealId,
    userId: mockUserId,
    ticker: 'AAPL',
    status: 'active',
    createdAt: new Date(),
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 600000),
    sonnetCalls: 0,
    opusCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    filesTotal: 0,
    filesProcessed: 0,
    filesFailed: 0,
  };

  beforeEach(async () => {
    const mockPrisma = {
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
      $executeRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionManagerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<SessionManagerService>(SessionManagerService);
    prisma = module.get(PrismaService);
    eventEmitter = module.get(EventEmitter2);
  });

  describe('createSession', () => {
    const createParams: CreateSessionParams = {
      tenantId: mockTenantId,
      dealId: mockDealId,
      userId: mockUserId,
      ticker: 'AAPL',
    };

    it('should create a session when rate limits allow', async () => {
      // Mock rate limit checks - both pass
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: 0 }]) // tenant sessions
        .mockResolvedValueOnce([{ count: 0 }]) // user+deal sessions
        .mockResolvedValueOnce([mockSession]); // insert

      const result = await service.createSession(createParams);

      expect(result).toEqual(mockSession);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('should reject when tenant has 3 active sessions', async () => {
      // Mock tenant at limit
      prisma.$queryRaw.mockResolvedValueOnce([{ count: 3 }]);

      await expect(service.createSession(createParams)).rejects.toThrow(RateLimitException);
    });

    it('should reject when user already has active session for deal', async () => {
      // Mock tenant under limit, but user+deal at limit
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: 1 }]) // tenant sessions OK
        .mockResolvedValueOnce([{ count: 1 }]); // user+deal at limit

      await expect(service.createSession(createParams)).rejects.toThrow(RateLimitException);
    });
  });

  describe('getSession', () => {
    it('should return session when found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([mockSession]);

      const result = await service.getSession(mockSessionId);

      expect(result).toEqual(mockSession);
    });

    it('should return null when session not found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.getSession(mockSessionId);

      expect(result).toBeNull();
    });
  });

  describe('getActiveSession', () => {
    it('should return active session for user+deal', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([mockSession]);

      const result = await service.getActiveSession(mockTenantId, mockDealId, mockUserId);

      expect(result).toEqual(mockSession);
    });

    it('should return null when no active session exists', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.getActiveSession(mockTenantId, mockDealId, mockUserId);

      expect(result).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('should update session status', async () => {
      const updatedSession = { ...mockSession, status: 'processing' as const };
      prisma.$queryRawUnsafe.mockResolvedValueOnce([updatedSession]);

      const result = await service.updateSession(mockSessionId, { status: 'processing' });

      expect(result.status).toBe('processing');
    });

    it('should update model usage counters', async () => {
      const updatedSession = { ...mockSession, sonnetCalls: 5, opusCalls: 2 };
      prisma.$queryRawUnsafe.mockResolvedValueOnce([updatedSession]);

      const result = await service.updateSession(mockSessionId, {
        sonnetCalls: 5,
        opusCalls: 2,
      });

      expect(result.sonnetCalls).toBe(5);
      expect(result.opusCalls).toBe(2);
    });

    it('should throw NotFoundException when session not found', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);

      await expect(
        service.updateSession(mockSessionId, { status: 'ended' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('endSession', () => {
    it('should end an active session', async () => {
      const endedSession = { ...mockSession, status: 'ended' as const };
      prisma.$queryRaw.mockResolvedValueOnce([endedSession]);

      const result = await service.endSession(mockSessionId);

      expect(result.status).toBe('ended');
    });

    it('should throw NotFoundException when session not found', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.endSession(mockSessionId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('extendTimeout', () => {
    it('should extend session timeout', async () => {
      const extendedSession = {
        ...mockSession,
        expiresAt: new Date(Date.now() + 600000),
      };
      prisma.$queryRaw.mockResolvedValueOnce([extendedSession]);

      const result = await service.extendTimeout(mockSessionId);

      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should throw NotFoundException for non-active session', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      await expect(service.extendTimeout(mockSessionId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('enforceRateLimits', () => {
    it('should allow when under all limits', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: 2 }]) // tenant under limit
        .mockResolvedValueOnce([{ count: 0 }]); // user+deal under limit

      const result = await service.enforceRateLimits(mockTenantId, mockUserId, mockDealId);

      expect(result.allowed).toBe(true);
    });

    it('should deny when tenant at limit', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ count: 3 }]);

      const result = await service.enforceRateLimits(mockTenantId, mockUserId, mockDealId);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('3 concurrent sessions');
    });

    it('should deny when user+deal at limit', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ count: 1 }]) // tenant OK
        .mockResolvedValueOnce([{ count: 1 }]); // user+deal at limit

      const result = await service.enforceRateLimits(mockTenantId, mockUserId, mockDealId);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Active session already exists');
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should mark expired sessions and emit events', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { id: 'session-1', tenant_id: mockTenantId, deal_id: mockDealId, user_id: mockUserId },
        { id: 'session-2', tenant_id: mockTenantId, deal_id: mockDealId, user_id: mockUserId },
      ]);

      const count = await service.cleanupExpiredSessions();

      expect(count).toBe(2);
      expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'instant-rag.session.expired',
        expect.objectContaining({ sessionId: 'session-1' }),
      );
    });

    it('should return 0 when no expired sessions', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const count = await service.cleanupExpiredSessions();

      expect(count).toBe(0);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('incrementModelUsage', () => {
    it('should increment sonnet usage', async () => {
      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      await service.incrementModelUsage(mockSessionId, 'sonnet', 1000, 500);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('sonnet_calls'),
        1000,
        500,
        mockSessionId,
      );
    });

    it('should increment opus usage', async () => {
      prisma.$executeRawUnsafe.mockResolvedValueOnce(1);

      await service.incrementModelUsage(mockSessionId, 'opus', 2000, 1000);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('opus_calls'),
        2000,
        1000,
        mockSessionId,
      );
    });
  });

  describe('incrementFileCounters', () => {
    it('should increment processed count', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(1);

      await service.incrementFileCounters(mockSessionId, 1, 0);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should increment failed count', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(1);

      await service.incrementFileCounters(mockSessionId, 0, 1);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('setFilesTotal', () => {
    it('should set total file count', async () => {
      prisma.$executeRaw.mockResolvedValueOnce(1);

      await service.setFilesTotal(mockSessionId, 5);

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });
});
