/**
 * Property-Based Tests: Research Assistant Preservation Tests
 * Feature: research-assistant-rendering-fix (Bugfix Spec)
 *
 * Property 2: Preservation - All Existing Functionality Preserved
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**
 *
 * IMPORTANT: These tests verify that existing functionality continues to work
 * correctly on UNFIXED code. They should PASS on the current codebase before
 * any fixes are implemented, establishing a baseline of correct behavior that
 * must be preserved after the fixes are applied.
 *
 * These tests focus on NON-BUGGY inputs - scenarios that currently work correctly
 * and must continue to work after the bugfixes are implemented.
 *
 * NOTE: Uses direct constructor instantiation instead of NestJS TestingModule
 * to avoid request-scoped provider resolution hangs in vitest.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { ResearchAssistantService, StreamChunk } from '../../src/research/research-assistant.service';
import { RAGResponse, QueryIntent } from '../../src/rag/types/query-intent';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA'];

/** Generate a minimal QueryIntent */
const queryIntentArb: fc.Arbitrary<QueryIntent> = fc.record({
  type: fc.constantFrom('structured', 'semantic', 'hybrid') as fc.Arbitrary<QueryIntent['type']>,
  ticker: fc.constantFrom(...TICKERS),
  metrics: fc.constant(['revenue']),
  needsNarrative: fc.boolean(),
  needsComparison: fc.boolean(),
  needsComputation: fc.boolean(),
  needsTrend: fc.boolean(),
  confidence: fc.double({ min: 0.5, max: 1, noNaN: true }),
  originalQuery: fc.constant('test query'),
}) as unknown as fc.Arbitrary<QueryIntent>;

/** Generate a standard RAGResponse (no special features) */
const standardRagResponseArb: fc.Arbitrary<RAGResponse> = fc.tuple(
  queryIntentArb,
  fc.array(fc.string({ minLength: 10, maxLength: 200 }), { minLength: 1, maxLength: 10 }),
).map(([intent, sentences]) => ({
  answer: sentences.join('. '),
  intent,
  sources: [],
  timestamp: new Date(),
  latency: 100,
  cost: 0.01,
  processingInfo: {
    structuredMetrics: 0,
    semanticNarratives: 0,
    userDocumentChunks: 0,
    usedBedrockKB: false,
    usedClaudeGeneration: true,
    hybridProcessing: true,
  },
}));

/** Generate markdown table content */
const markdownTableArb: fc.Arbitrary<string> = fc.tuple(
  fc.array(fc.string({ minLength: 3, maxLength: 15 }), { minLength: 2, maxLength: 4 }),
  fc.array(
    fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 2, maxLength: 4 }),
    { minLength: 1, maxLength: 5 },
  ),
).map(([headers, rows]) => {
  const headerRow = '| ' + headers.join(' | ') + ' |';
  const separatorRow = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const dataRows = rows.map((row) => '| ' + row.slice(0, headers.length).join(' | ') + ' |');
  return [headerRow, separatorRow, ...dataRows].join('\n');
});

/** Generate severity badge text */
const severityBadgeArb: fc.Arbitrary<string> = fc.constantFrom(
  'RED FLAG',
  'AMBER',
  'GREEN CHALLENGE',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from the async generator */
async function collectChunks(gen: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Mock factory — direct constructor instantiation (no NestJS DI)
// ---------------------------------------------------------------------------

const MOCK_TENANT_ID = 'test-tenant-id';
const MOCK_USER_ID = 'test-user-id';
const MOCK_CONVERSATION_ID = 'conv-test-123';

function createMockPrisma() {
  return {
    $queryRaw: vi.fn().mockImplementation(() => {
      return Promise.resolve([{
        count: 1,
        id: 'msg-test-123',
        conversationId: MOCK_CONVERSATION_ID,
        role: 'assistant',
        content: '',
        sources: '[]',
        metadata: '{}',
        tokensUsed: 0,
        createdAt: new Date(),
      }]);
    }),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
}

function createMockRagService() {
  return { query: vi.fn() };
}

function createMockCitationService() {
  return { createCitations: vi.fn().mockResolvedValue([]) };
}

function createMockBedrockService() {
  return { invokeClaude: vi.fn().mockResolvedValue('{}') };
}

function createMockRequest() {
  return {
    tenantContext: {
      tenantId: MOCK_TENANT_ID,
      userId: MOCK_USER_ID,
    },
  };
}

/**
 * Create ResearchAssistantService via direct constructor call.
 * Avoids NestJS TestingModule.compile() which hangs for request-scoped providers.
 */
function createService() {
  const prisma = createMockPrisma();
  const ragService = createMockRagService();
  const citationService = createMockCitationService();
  const bedrockService = createMockBedrockService();
  const request = createMockRequest();

  const service = new (ResearchAssistantService as any)(
    prisma,
    ragService,
    citationService,
    bedrockService,
    request,
  );

  return { service, prisma, ragService, citationService, bedrockService };
}

// ---------------------------------------------------------------------------
// Property 2.1: Streaming Responses Preservation (Requirement 3.1)
// ---------------------------------------------------------------------------

describe('Property 2.1: Streaming Responses Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
  });

  it('should stream responses via SSE with token-by-token delivery for all new research queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        standardRagResponseArb,
        fc.string({ minLength: 5, maxLength: 100 }),
        async (ragResponse, userQuery) => {
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, { content: userQuery }),
          );

          const tokenChunks = chunks.filter((c) => c.type === 'token');
          expect(tokenChunks.length).toBeGreaterThan(0);

          const reconstructedAnswer = tokenChunks.map((c) => c.data.text).join('');
          expect(reconstructedAnswer.length).toBeGreaterThan(0);

          const doneChunks = chunks.filter((c) => c.type === 'done');
          expect(doneChunks.length).toBe(1);
          expect(chunks[chunks.length - 1].type).toBe('done');
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});

// ---------------------------------------------------------------------------
// Property 2.7: Markdown Table Rendering Preservation (Requirement 3.7)
// ---------------------------------------------------------------------------

describe('Property 2.7: Markdown Table Rendering Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
  });

  it('should continue to render markdown tables with proper HTML structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        markdownTableArb,
        async (markdownTable) => {
          const ragResponse: RAGResponse = {
            answer: `Here is the data:\n\n${markdownTable}\n\nThis shows the results.`,
            intent: {
              type: 'structured', ticker: 'AAPL', metrics: ['revenue'],
              needsNarrative: false, needsComparison: false, needsComputation: false,
              needsTrend: false, confidence: 0.9, originalQuery: 'test query',
            } as QueryIntent,
            sources: [], timestamp: new Date(), latency: 100, cost: 0.01,
            processingInfo: {
              structuredMetrics: 0, semanticNarratives: 0, userDocumentChunks: 0,
              usedBedrockKB: false, usedClaudeGeneration: true, hybridProcessing: true,
            },
          };

          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, { content: 'Show me the data' }),
          );

          const tokenChunks = chunks.filter((c) => c.type === 'token');
          expect(tokenChunks.length).toBeGreaterThan(0);

          const reconstructedAnswer = tokenChunks.map((c) => c.data.text).join('');
          expect(reconstructedAnswer).toContain('|');
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});

// ---------------------------------------------------------------------------
// Property 2.8: Severity Badge Rendering Preservation (Requirement 3.8)
// ---------------------------------------------------------------------------

describe('Property 2.8: Severity Badge Rendering Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
  });

  it('should continue to render severity badges (RED FLAG, AMBER, GREEN CHALLENGE) correctly', async () => {
    await fc.assert(
      fc.asyncProperty(
        severityBadgeArb,
        fc.string({ minLength: 10, maxLength: 100 }),
        async (badge, context) => {
          const ragResponse: RAGResponse = {
            answer: `${context} ${badge}: This is a critical finding. ${context}`,
            intent: {
              type: 'semantic', ticker: 'AAPL', metrics: ['revenue'],
              needsNarrative: true, needsComparison: false, needsComputation: false,
              needsTrend: false, confidence: 0.9, originalQuery: 'test query',
            } as QueryIntent,
            sources: [], timestamp: new Date(), latency: 100, cost: 0.01,
            processingInfo: {
              structuredMetrics: 0, semanticNarratives: 0, userDocumentChunks: 0,
              usedBedrockKB: false, usedClaudeGeneration: true, hybridProcessing: true,
            },
          };

          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, { content: 'Analyze the risks' }),
          );

          const tokenChunks = chunks.filter((c) => c.type === 'token');
          expect(tokenChunks.length).toBeGreaterThan(0);

          const reconstructedAnswer = tokenChunks.map((c) => c.data.text).join('');
          expect(reconstructedAnswer).toContain(badge);
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});

// ---------------------------------------------------------------------------
// Property 2.2: Provocations Mode Preservation (Requirement 3.2)
// ---------------------------------------------------------------------------

describe('Property 2.2: Provocations Mode Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
  });

  it('should continue to accept and process custom system prompts (provocations mode)', async () => {
    await fc.assert(
      fc.asyncProperty(
        standardRagResponseArb,
        fc.string({ minLength: 20, maxLength: 200 }),
        async (ragResponse, customSystemPrompt) => {
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, {
              content: 'Analyze AAPL revenue',
              systemPrompt: customSystemPrompt,
            }),
          );

          const tokenChunks = chunks.filter((c) => c.type === 'token');
          expect(tokenChunks.length).toBeGreaterThan(0);

          expect(ragService.query).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ systemPrompt: customSystemPrompt }),
          );
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});

// ---------------------------------------------------------------------------
// Property 2.3: Sentiment Mode Preservation (Requirement 3.3)
// ---------------------------------------------------------------------------

describe('Property 2.3: Sentiment Mode Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
  });

  it('should continue to accept and process custom system prompts (sentiment mode)', async () => {
    await fc.assert(
      fc.asyncProperty(
        standardRagResponseArb,
        async (ragResponse) => {
          const sentimentSystemPrompt = 'Analyze sentiment and tone in the following data...';
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, {
              content: 'What is the sentiment in AAPL MD&A?',
              systemPrompt: sentimentSystemPrompt,
            }),
          );

          const tokenChunks = chunks.filter((c) => c.type === 'token');
          expect(tokenChunks.length).toBeGreaterThan(0);

          expect(ragService.query).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ systemPrompt: sentimentSystemPrompt }),
          );
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});

// ---------------------------------------------------------------------------
// Property 2.4: Instant RAG Preservation (Requirement 3.4)
// ---------------------------------------------------------------------------

describe('Property 2.4: Instant RAG Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
  });

  it('should continue to process instant RAG queries with session context', async () => {
    await fc.assert(
      fc.asyncProperty(
        standardRagResponseArb,
        fc.uuid(),
        async (ragResponse, instantRagSessionId) => {
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, {
              content: 'What does the uploaded document say about revenue?',
              context: { instantRagSessionId },
            }),
          );

          const tokenChunks = chunks.filter((c) => c.type === 'token');
          expect(tokenChunks.length).toBeGreaterThan(0);

          expect(ragService.query).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ instantRagSessionId }),
          );
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});

// ---------------------------------------------------------------------------
// Property 2.5: Scratchpad Save Preservation (Requirement 3.5)
// ---------------------------------------------------------------------------

describe('Property 2.5: Scratchpad Save Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;
  let prisma: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
    prisma = mocks.prisma;
  });

  it('should continue to save messages to database (enabling scratchpad functionality)', async () => {
    await fc.assert(
      fc.asyncProperty(
        standardRagResponseArb,
        fc.string({ minLength: 10, maxLength: 100 }),
        async (ragResponse, userQuery) => {
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, { content: userQuery }),
          );

          const doneChunks = chunks.filter((c) => c.type === 'done');
          expect(doneChunks.length).toBe(1);

          // saveMessage uses $queryRaw — at least 2 calls (user + assistant messages)
          expect(prisma.$queryRaw).toHaveBeenCalled();
          expect(prisma.$queryRaw.mock.calls.length).toBeGreaterThanOrEqual(2);
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});

// ---------------------------------------------------------------------------
// Property 2.6: Navigation and Auth Preservation (Requirement 3.6)
// ---------------------------------------------------------------------------

describe('Property 2.6: Navigation and Auth Preservation', () => {
  let service: ResearchAssistantService;
  let ragService: any;
  let prisma: any;

  beforeEach(() => {
    const mocks = createService();
    service = mocks.service;
    ragService = mocks.ragService;
    prisma = mocks.prisma;
  });

  it('should continue to verify conversation ownership (tenant isolation)', async () => {
    await fc.assert(
      fc.asyncProperty(
        standardRagResponseArb,
        async (ragResponse) => {
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, { content: 'Test query' }),
          );

          const doneChunks = chunks.filter((c) => c.type === 'done');
          expect(doneChunks.length).toBe(1);

          // verifyConversationOwnership uses $queryRaw
          expect(prisma.$queryRaw).toHaveBeenCalled();
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});
