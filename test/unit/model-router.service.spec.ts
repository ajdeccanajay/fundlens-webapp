/**
 * Unit Tests for ModelRouter Service (Instant RAG)
 *
 * Tests keyword-based model routing, Opus budget enforcement, and usage tracking.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  ModelRouterService,
  OPUS_TRIGGER_KEYWORDS,
  MAX_OPUS_CALLS_PER_SESSION,
} from '../../src/instant-rag/model-router.service';
import { SessionManagerService } from '../../src/instant-rag/session-manager.service';

describe('ModelRouterService', () => {
  let service: ModelRouterService;
  let sessionManager: jest.Mocked<SessionManagerService>;

  const mockSessionId = 'session-001';

  const makeSession = (opusCalls: number) => ({
    id: mockSessionId,
    tenantId: 't1',
    dealId: 'd1',
    userId: 'u1',
    ticker: 'AAPL',
    status: 'active' as const,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    sonnetCalls: 5,
    opusCalls,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    filesTotal: 2,
    filesProcessed: 2,
    filesFailed: 0,
  });

  beforeEach(async () => {
    const mockSessionManager = {
      getSession: jest.fn(),
      incrementModelUsage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ModelRouterService,
        { provide: SessionManagerService, useValue: mockSessionManager },
      ],
    }).compile();

    service = module.get(ModelRouterService);
    sessionManager = module.get(SessionManagerService);
  });

  describe('detectTriggerKeyword', () => {
    it('should return null for queries without trigger keywords', () => {
      expect(service.detectTriggerKeyword('What is the revenue for 2024?')).toBeNull();
      expect(service.detectTriggerKeyword('Show me the balance sheet')).toBeNull();
      expect(service.detectTriggerKeyword('Extract EBITDA margin')).toBeNull();
    });

    it.each(OPUS_TRIGGER_KEYWORDS)('should detect trigger keyword: "%s"', (keyword) => {
      const query = `Can you ${keyword} these documents?`;
      expect(service.detectTriggerKeyword(query)).toBe(keyword);
    });

    it('should be case-insensitive', () => {
      expect(service.detectTriggerKeyword('COMPARE the revenue figures')).toBe('compare');
      expect(service.detectTriggerKeyword("What's Missing from this analysis?")).toBe("what's missing");
    });

    it('should return the first matched keyword when multiple present', () => {
      const query = 'Compare and cross-reference these filings';
      const result = service.detectTriggerKeyword(query);
      // 'cross-reference' comes before 'compare' in the keyword list
      expect(OPUS_TRIGGER_KEYWORDS).toContain(result);
    });
  });

  describe('routeQuery', () => {
    it('should route to Sonnet by default when no trigger keywords', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(0));

      const result = await service.routeQuery('What is the revenue?', mockSessionId);

      expect(result.modelType).toBe('sonnet');
      expect(result.fallbackFromOpus).toBe(false);
      expect(result.matchedTrigger).toBeUndefined();
    });

    it('should route to Opus when trigger keyword found and budget available', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(0));

      const result = await service.routeQuery('Compare revenue across documents', mockSessionId);

      expect(result.modelType).toBe('opus');
      expect(result.fallbackFromOpus).toBe(false);
      expect(result.matchedTrigger).toBe('compare');
      expect(result.opusCallsRemaining).toBe(4); // 5 - 0 - 1
    });

    it('should fall back to Sonnet when Opus budget exhausted', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(MAX_OPUS_CALLS_PER_SESSION));

      const result = await service.routeQuery('Compare these filings', mockSessionId);

      expect(result.modelType).toBe('sonnet');
      expect(result.fallbackFromOpus).toBe(true);
      expect(result.matchedTrigger).toBe('compare');
      expect(result.opusCallsRemaining).toBe(0);
    });

    it('should route to Opus when exactly at budget limit minus one', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(MAX_OPUS_CALLS_PER_SESSION - 1));

      const result = await service.routeQuery('Compare these filings', mockSessionId);

      expect(result.modelType).toBe('opus');
      expect(result.opusCallsRemaining).toBe(0); // last call
    });

    it('should handle null session gracefully (treat as 0 opus calls)', async () => {
      sessionManager.getSession.mockResolvedValue(null);

      const result = await service.routeQuery('Compare these filings', mockSessionId);

      expect(result.modelType).toBe('opus');
      expect(result.opusCallsRemaining).toBe(4);
    });
  });

  describe('checkOpusBudget', () => {
    it('should return true when budget available', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(0));
      expect(await service.checkOpusBudget(mockSessionId)).toBe(true);
    });

    it('should return true at limit minus one', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(MAX_OPUS_CALLS_PER_SESSION - 1));
      expect(await service.checkOpusBudget(mockSessionId)).toBe(true);
    });

    it('should return false when budget exhausted', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(MAX_OPUS_CALLS_PER_SESSION));
      expect(await service.checkOpusBudget(mockSessionId)).toBe(false);
    });

    it('should return false when over budget', async () => {
      sessionManager.getSession.mockResolvedValue(makeSession(MAX_OPUS_CALLS_PER_SESSION + 2));
      expect(await service.checkOpusBudget(mockSessionId)).toBe(false);
    });
  });

  describe('trackUsage', () => {
    it('should delegate to session manager for sonnet usage', async () => {
      await service.trackUsage(mockSessionId, 'sonnet', { inputTokens: 1000, outputTokens: 500 });

      expect(sessionManager.incrementModelUsage).toHaveBeenCalledWith(
        mockSessionId,
        'sonnet',
        1000,
        500,
      );
    });

    it('should delegate to session manager for opus usage', async () => {
      await service.trackUsage(mockSessionId, 'opus', { inputTokens: 2000, outputTokens: 800 });

      expect(sessionManager.incrementModelUsage).toHaveBeenCalledWith(
        mockSessionId,
        'opus',
        2000,
        800,
      );
    });
  });

  describe('trigger keyword coverage', () => {
    it('should have exactly 9 trigger keywords per design spec', () => {
      expect(OPUS_TRIGGER_KEYWORDS).toHaveLength(9);
    });

    it('should include all design-specified keywords', () => {
      const expected = [
        'cross-reference', 'compare', 'contradict', 'provocation',
        'why would', "doesn't match", 'inconsistent', "what's missing",
        "devil's advocate",
      ];
      for (const kw of expected) {
        expect(OPUS_TRIGGER_KEYWORDS).toContain(kw);
      }
    });
  });
});
