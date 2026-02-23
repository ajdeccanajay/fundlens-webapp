/**
 * Property-Based Tests: ResearchAssistantService — Stream Chunk Ordering
 * Feature: multimodal-research-responses
 *
 * Property 5: Visualization stream chunk ordering
 * **Validates: Requirements 3.2, 3.4**
 *
 * For any streamed response from ResearchAssistantService.sendMessage(),
 * if the underlying RAGResponse contains a visualization field, then the
 * yielded chunks shall include exactly one chunk with type === 'visualization'
 * and it shall appear before any chunk with type === 'token'. Conversely,
 * if the RAGResponse has no visualization field, no chunk with
 * type === 'visualization' shall be yielded.
 */

import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';
import { ResearchAssistantService, StreamChunk } from '../../src/research/research-assistant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RAGService } from '../../src/rag/rag.service';
import { CitationService } from '../../src/rag/citation.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { RAGResponse, QueryIntent } from '../../src/rag/types/query-intent';
import { VisualizationPayload, ChartType } from '../../src/rag/types/visualization';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const TICKERS = ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA', 'TSLA'];
const FISCAL_PERIODS = ['FY2019', 'FY2020', 'FY2021', 'FY2022', 'FY2023', 'FY2024'];
const METRIC_NAMES = [
  'revenue', 'net_income', 'gross_profit', 'operating_income',
  'ebitda', 'free_cash_flow', 'gross_margin', 'operating_margin',
];

/** Generate a VisualizationPayload */
const visualizationPayloadArb: fc.Arbitrary<VisualizationPayload> = fc.record({
  chartType: fc.constantFrom('line', 'bar', 'groupedBar') as fc.Arbitrary<ChartType>,
  title: fc.string({ minLength: 1, maxLength: 80 }),
  labels: fc.array(fc.constantFrom(...FISCAL_PERIODS), { minLength: 2, maxLength: 6 }),
  datasets: fc.array(
    fc.record({
      label: fc.constantFrom(...METRIC_NAMES),
      data: fc.array(fc.double({ min: 1_000, max: 1_000_000_000, noNaN: true }), {
        minLength: 2,
        maxLength: 6,
      }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
});

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

/** Generate a RAGResponse WITH a visualization */
const ragResponseWithVisualizationArb: fc.Arbitrary<RAGResponse> = fc.tuple(
  queryIntentArb,
  visualizationPayloadArb,
  fc.array(fc.string({ minLength: 5, maxLength: 100 }), { minLength: 1, maxLength: 5 }),
).map(([intent, visualization, sentences]) => ({
  answer: sentences.join('. '),
  intent,
  sources: [],
  visualization,
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

/** Generate a RAGResponse WITHOUT a visualization */
const ragResponseWithoutVisualizationArb: fc.Arbitrary<RAGResponse> = fc.tuple(
  queryIntentArb,
  fc.array(fc.string({ minLength: 5, maxLength: 100 }), { minLength: 1, maxLength: 5 }),
).map(([intent, sentences]) => ({
  answer: sentences.join('. '),
  intent,
  sources: [],
  // No visualization field
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
// Mock factory for request-scoped service
// ---------------------------------------------------------------------------

const MOCK_TENANT_ID = 'test-tenant-id';
const MOCK_USER_ID = 'test-user-id';
const MOCK_CONVERSATION_ID = 'conv-test-123';

function createMockRequest() {
  return {
    tenantContext: {
      tenantId: MOCK_TENANT_ID,
      userId: MOCK_USER_ID,
    },
  };
}

function createMockPrisma() {
  return {
    $queryRaw: jest.fn().mockImplementation(() => {
      // Default: verifyConversationOwnership returns count=1 (found)
      // saveMessage returns a message object
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
    researchConversation: {
      findFirst: jest.fn().mockResolvedValue({
        id: MOCK_CONVERSATION_ID,
        tenantId: MOCK_TENANT_ID,
        userId: MOCK_USER_ID,
      }),
    },
    researchMessage: {
      create: jest.fn().mockResolvedValue({
        id: 'msg-test-123',
        conversationId: MOCK_CONVERSATION_ID,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Property 5: Visualization stream chunk ordering
// **Validates: Requirements 3.2, 3.4**
// ---------------------------------------------------------------------------

describe('Property 5: Visualization stream chunk ordering', () => {
  let service: ResearchAssistantService;
  let ragService: jest.Mocked<RAGService>;
  let prisma: any;
  let citationService: jest.Mocked<CitationService>;

  beforeEach(async () => {
    prisma = createMockPrisma();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchAssistantService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: RAGService,
          useValue: {
            query: jest.fn(),
          },
        },
        {
          provide: CitationService,
          useValue: {
            createCitations: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: BedrockService,
          useValue: {},
        },
        {
          provide: REQUEST,
          useValue: createMockRequest(),
        },
      ],
    }).compile();

    service = await module.resolve(ResearchAssistantService);
    ragService = module.get(RAGService);
    citationService = module.get(CitationService);
  });

  it('should yield exactly one visualization chunk before any token chunk when RAGResponse has visualization', async () => {
    await fc.assert(
      fc.asyncProperty(
        ragResponseWithVisualizationArb,
        async (ragResponse) => {
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, {
              content: 'Show me revenue trend for AAPL',
            }),
          );

          const vizChunks = chunks.filter((c) => c.type === 'visualization');
          const tokenChunks = chunks.filter((c) => c.type === 'token');

          // Exactly one visualization chunk
          expect(vizChunks.length).toBe(1);

          // Visualization data matches the RAGResponse payload
          expect(vizChunks[0].data).toEqual(ragResponse.visualization);

          // If there are token chunks, visualization must come before all of them
          if (tokenChunks.length > 0) {
            const vizIndex = chunks.indexOf(vizChunks[0]);
            const firstTokenIndex = chunks.indexOf(tokenChunks[0]);
            expect(vizIndex).toBeLessThan(firstTokenIndex);
          }
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);

  it('should yield no visualization chunk when RAGResponse has no visualization', async () => {
    await fc.assert(
      fc.asyncProperty(
        ragResponseWithoutVisualizationArb,
        async (ragResponse) => {
          ragService.query.mockResolvedValue(ragResponse);

          const chunks = await collectChunks(
            service.sendMessage(MOCK_CONVERSATION_ID, {
              content: 'What is AAPL revenue?',
            }),
          );

          const vizChunks = chunks.filter((c) => c.type === 'visualization');

          // No visualization chunk should be yielded
          expect(vizChunks.length).toBe(0);

          // Should still have token chunks (the answer text)
          const tokenChunks = chunks.filter((c) => c.type === 'token');
          expect(tokenChunks.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 10 },
    );
  }, 60000);
});
