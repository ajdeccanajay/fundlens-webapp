/**
 * Unit Tests for ModelRouter Integration with InstantRAGService
 *
 * Tests that queries are routed through ModelRouter and the correct model is used.
 * Verifies fallback notifications and usage tracking.
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

import { Test, TestingModule } from '@nestjs/testing';
import { InstantRAGService, QueryStreamChunk } from '../../src/instant-rag/instant-rag.service';
import { SessionManagerService } from '../../src/instant-rag/session-manager.service';
import { DocumentProcessorService } from '../../src/instant-rag/document-processor.service';
import { FileValidatorService } from '../../src/instant-rag/file-validator.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelRouterService } from '../../src/instant-rag/model-router.service';

describe('ModelRouter Integration with InstantRAGService', () => {
  let service: InstantRAGService;
  let modelRouter: jest.Mocked<ModelRouterService>;
  let bedrockService: jest.Mocked<BedrockService>;
  let sessionManager: jest.Mocked<SessionManagerService>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockSessionId = 'session-integration-001';
  const SONNET_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';
  const OPUS_ID = 'us.anthropic.claude-opus-4-5-20251101-v1:0';

  const mockSession = {
    id: mockSessionId,
    tenantId: 't1',
    dealId: 'd1',
    userId: 'u1',
    ticker: 'AAPL',
    status: 'active' as const,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 600_000),
    sonnetCalls: 0,
    opusCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    filesTotal: 1,
    filesProcessed: 1,
    filesFailed: 0,
  };

  const mockDocument = {
    id: 'doc-001',
    fileName: 'AAPL_10K.pdf',
    fileType: 'pdf',
    fileSizeBytes: 5000000,
    contentHash: 'hash123',
    pageCount: 50,
    processingStatus: 'complete',
    extractedText: 'Apple Inc. Revenue was $383.3 billion for fiscal 2024.',
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstantRAGService,
        {
          provide: ModelRouterService,
          useValue: {
            routeQuery: jest.fn(),
            trackUsage: jest.fn(),
            checkOpusBudget: jest.fn(),
            detectTriggerKeyword: jest.fn(),
          },
        },
        {
          provide: BedrockService,
          useValue: {
            invokeClaude: jest.fn(),
            invokeClaudeWithVision: jest.fn(),
          },
        },
        {
          provide: SessionManagerService,
          useValue: {
            getSession: jest.fn(),
            extendTimeout: jest.fn(),
            incrementModelUsage: jest.fn(),
          },
        },
        {
          provide: DocumentProcessorService,
          useValue: { processFile: jest.fn() },
        },
        {
          provide: FileValidatorService,
          useValue: { validateBatch: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(InstantRAGService);
    modelRouter = module.get(ModelRouterService);
    bedrockService = module.get(BedrockService);
    sessionManager = module.get(SessionManagerService);
    prismaService = module.get(PrismaService);
  });

  /** Helper to collect all chunks from the query async generator */
  async function collectChunks(
    sessionId: string,
    query: string,
  ): Promise<QueryStreamChunk[]> {
    const chunks: QueryStreamChunk[] = [];
    for await (const chunk of service.query(sessionId, query)) {
      chunks.push(chunk);
    }
    return chunks;
  }

  /** Set up standard mocks for a successful query */
  function setupQueryMocks(modelSelection: any) {
    sessionManager.getSession.mockResolvedValue(mockSession);
    sessionManager.extendTimeout.mockResolvedValue(undefined);
    modelRouter.routeQuery.mockResolvedValue(modelSelection);
    modelRouter.trackUsage.mockResolvedValue(undefined);
    // getSessionDocuments + storeQALogEntry calls
    prismaService.$queryRaw
      .mockResolvedValueOnce([mockDocument]) // getSessionDocuments (for getDocumentContent)
      .mockResolvedValueOnce(undefined) // storeQALogEntry (user)
      .mockResolvedValueOnce(undefined); // storeQALogEntry (assistant)
    bedrockService.invokeClaude.mockResolvedValue(
      'Revenue was $383.3 billion [Doc 1, p.5].',
    );
  }

  describe('query routing through ModelRouter', () => {
    it('should route standard queries to Sonnet via ModelRouter', async () => {
      setupQueryMocks({
        modelId: SONNET_ID,
        modelType: 'sonnet',
        fallbackFromOpus: false,
        opusCallsRemaining: 5,
      });

      const chunks = await collectChunks(mockSessionId, 'What is the revenue?');

      expect(modelRouter.routeQuery).toHaveBeenCalledWith(
        'What is the revenue?',
        mockSessionId,
      );

      const modelInfo = chunks.find(c => c.type === 'model_info');
      expect(modelInfo).toBeDefined();
      if (modelInfo && modelInfo.type === 'model_info') {
        expect(modelInfo.modelType).toBe('sonnet');
        expect(modelInfo.fallbackFromOpus).toBe(false);
      }
    });

    it('should route trigger-keyword queries to Opus via ModelRouter', async () => {
      setupQueryMocks({
        modelId: OPUS_ID,
        modelType: 'opus',
        fallbackFromOpus: false,
        matchedTrigger: 'compare',
        opusCallsRemaining: 4,
      });

      const chunks = await collectChunks(
        mockSessionId,
        'Compare revenue across documents',
      );

      expect(modelRouter.routeQuery).toHaveBeenCalledWith(
        'Compare revenue across documents',
        mockSessionId,
      );

      const modelInfo = chunks.find(c => c.type === 'model_info');
      expect(modelInfo).toBeDefined();
      if (modelInfo && modelInfo.type === 'model_info') {
        expect(modelInfo.modelType).toBe('opus');
        expect(modelInfo.fallbackFromOpus).toBe(false);
        expect(modelInfo.matchedTrigger).toBe('compare');
        expect(modelInfo.opusCallsRemaining).toBe(4);
      }
    });

    it('should emit fallback notice when Opus budget exhausted', async () => {
      setupQueryMocks({
        modelId: SONNET_ID,
        modelType: 'sonnet',
        fallbackFromOpus: true,
        matchedTrigger: 'compare',
        opusCallsRemaining: 0,
      });

      const chunks = await collectChunks(
        mockSessionId,
        'Compare these filings',
      );

      const modelInfo = chunks.find(c => c.type === 'model_info');
      expect(modelInfo).toBeDefined();
      if (modelInfo && modelInfo.type === 'model_info') {
        expect(modelInfo.modelType).toBe('sonnet');
        expect(modelInfo.fallbackFromOpus).toBe(true);
        expect(modelInfo.matchedTrigger).toBe('compare');
        expect(modelInfo.opusCallsRemaining).toBe(0);
      }
    });

    it('should use the model ID from ModelRouter for Claude calls', async () => {
      setupQueryMocks({
        modelId: OPUS_ID,
        modelType: 'opus',
        fallbackFromOpus: false,
        matchedTrigger: 'cross-reference',
        opusCallsRemaining: 3,
      });

      await collectChunks(mockSessionId, 'Cross-reference these documents');

      // Verify the Opus model ID was passed to invokeClaude
      expect(bedrockService.invokeClaude).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: OPUS_ID }),
      );
    });
  });

  describe('usage tracking through ModelRouter', () => {
    it('should track Sonnet usage via ModelRouter after query', async () => {
      setupQueryMocks({
        modelId: SONNET_ID,
        modelType: 'sonnet',
        fallbackFromOpus: false,
        opusCallsRemaining: 5,
      });

      await collectChunks(mockSessionId, 'What is the revenue?');

      expect(modelRouter.trackUsage).toHaveBeenCalledWith(
        mockSessionId,
        'sonnet',
        expect.objectContaining({
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
        }),
      );
    });

    it('should track Opus usage via ModelRouter after query', async () => {
      setupQueryMocks({
        modelId: OPUS_ID,
        modelType: 'opus',
        fallbackFromOpus: false,
        matchedTrigger: 'compare',
        opusCallsRemaining: 4,
      });

      await collectChunks(mockSessionId, 'Compare revenue across documents');

      expect(modelRouter.trackUsage).toHaveBeenCalledWith(
        mockSessionId,
        'opus',
        expect.objectContaining({
          inputTokens: expect.any(Number),
          outputTokens: expect.any(Number),
        }),
      );
    });
  });

  describe('stream chunk ordering', () => {
    it('should emit model_info before content and done', async () => {
      setupQueryMocks({
        modelId: SONNET_ID,
        modelType: 'sonnet',
        fallbackFromOpus: false,
        opusCallsRemaining: 5,
      });

      const chunks = await collectChunks(mockSessionId, 'What is the revenue?');

      const types = chunks.map(c => c.type);
      const modelInfoIdx = types.indexOf('model_info');
      const contentIdx = types.indexOf('content');
      const doneIdx = types.indexOf('done');

      expect(modelInfoIdx).toBeGreaterThanOrEqual(0);
      expect(contentIdx).toBeGreaterThan(modelInfoIdx);
      expect(doneIdx).toBeGreaterThan(contentIdx);
    });
  });
});
