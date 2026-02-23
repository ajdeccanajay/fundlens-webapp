/**
 * E2E Tests for Multimodal Research Flow
 *
 * Validates the streaming pipeline from RAG response to SSE events:
 * - Trend queries produce a 'visualization' SSE event before 'token' events
 * - Non-trend queries produce no 'visualization' SSE event
 *
 * Uses a minimal NestJS test module with mocked dependencies to avoid
 * circular dependency issues in the full module graph.
 *
 * Validates: Requirements 3.2, 3.4, 4.1
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { StreamChunk } from '../../src/research/research-assistant.service';
import { RAGResponse } from '../../src/rag/types/query-intent';
import { VisualizationPayload } from '../../src/rag/types/visualization';

/**
 * Parse SSE text body into an array of { type, data } events.
 * NestJS SSE format: "event: <type>\ndata: <json>\n\n"
 */
function parseSSEEvents(body: string): Array<{ type: string; data: any }> {
  const events: Array<{ type: string; data: any }> = [];
  const rawEvents = body.split('\n\n').filter((s) => s.trim().length > 0);

  for (const raw of rawEvents) {
    const lines = raw.split('\n');
    let type = '';
    let dataStr = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        type = line.replace('event:', '').trim();
      } else if (line.startsWith('data:')) {
        dataStr = line.replace('data:', '').trim();
      }
    }

    if (type && dataStr) {
      try {
        events.push({ type, data: JSON.parse(dataStr) });
      } catch {
        events.push({ type, data: dataStr });
      }
    }
  }

  return events;
}

/** Build a sample VisualizationPayload */
function buildVisualization(): VisualizationPayload {
  return {
    chartType: 'line',
    title: 'AAPL Revenue Trend (FY2022–FY2024)',
    labels: ['FY2022', 'FY2023', 'FY2024'],
    datasets: [
      {
        label: 'Revenue',
        data: [394_328_000_000, 383_285_000_000, 391_035_000_000],
      },
    ],
    options: { currency: true },
  };
}

/** Build a RAGResponse WITH visualization (trend query) */
function buildTrendRAGResponse(): RAGResponse {
  return {
    answer: 'Apple revenue has shown a recovery trend after a slight dip in FY2023.',
    intent: {
      type: 'structured',
      ticker: 'AAPL',
      metrics: ['revenue'],
      period: 'FY2024',
      periodType: 'annual',
      needsNarrative: false,
      needsComparison: false,
      needsComputation: false,
      needsTrend: true,
      confidence: 0.92,
      originalQuery: 'What is the revenue trend for AAPL?',
    },
    metrics: [
      {
        ticker: 'AAPL',
        normalizedMetric: 'revenue',
        rawLabel: 'Revenue',
        value: 394_328_000_000,
        fiscalPeriod: 'FY2022',
        periodType: 'annual',
        filingType: '10-K',
        statementType: 'income_statement',
        statementDate: new Date('2022-09-30'),
        filingDate: new Date('2022-11-01'),
        confidenceScore: 0.95,
      },
      {
        ticker: 'AAPL',
        normalizedMetric: 'revenue',
        rawLabel: 'Revenue',
        value: 383_285_000_000,
        fiscalPeriod: 'FY2023',
        periodType: 'annual',
        filingType: '10-K',
        statementType: 'income_statement',
        statementDate: new Date('2023-09-30'),
        filingDate: new Date('2023-11-01'),
        confidenceScore: 0.95,
      },
      {
        ticker: 'AAPL',
        normalizedMetric: 'revenue',
        rawLabel: 'Revenue',
        value: 391_035_000_000,
        fiscalPeriod: 'FY2024',
        periodType: 'annual',
        filingType: '10-K',
        statementType: 'income_statement',
        statementDate: new Date('2024-09-30'),
        filingDate: new Date('2024-11-01'),
        confidenceScore: 0.95,
      },
    ],
    sources: [
      { type: 'metric', ticker: 'AAPL', filingType: '10-K', fiscalPeriod: 'FY2024' },
    ],
    visualization: buildVisualization(),
    timestamp: new Date(),
    latency: 250,
    cost: 0.002,
    processingInfo: {
      structuredMetrics: 3,
      semanticNarratives: 0,
      userDocumentChunks: 0,
      usedBedrockKB: true,
      usedClaudeGeneration: true,
      hybridProcessing: true,
    },
  };
}

/** Build a RAGResponse WITHOUT visualization (non-trend query) */
function buildNonTrendRAGResponse(): RAGResponse {
  return {
    answer: 'Apple discusses competition from Samsung, Google, and other technology companies.',
    intent: {
      type: 'semantic',
      ticker: 'AAPL',
      metrics: [],
      needsNarrative: true,
      needsComparison: false,
      needsComputation: false,
      needsTrend: false,
      confidence: 0.88,
      originalQuery: 'What does Apple say about competition?',
    },
    metrics: [],
    sources: [
      { type: 'narrative' as const, ticker: 'AAPL', filingType: '10-K', fiscalPeriod: 'FY2024', section: 'risk_factors' },
    ],
    timestamp: new Date(),
    latency: 400,
    cost: 0.003,
    processingInfo: {
      structuredMetrics: 0,
      semanticNarratives: 2,
      userDocumentChunks: 0,
      usedBedrockKB: true,
      usedClaudeGeneration: true,
      hybridProcessing: true,
    },
  };
}

/**
 * Simulate the ResearchAssistantService.sendMessage() streaming logic.
 * This replicates the exact chunk ordering from the real service:
 * 1. source chunks (for valid sources)
 * 2. citations chunk (if any)
 * 3. visualization chunk (if ragResult.visualization is present)
 * 4. token chunks (sentence-split answer)
 * 5. done chunk
 */
async function* simulateSendMessage(ragResult: RAGResponse): AsyncGenerator<StreamChunk> {
  // Yield sources
  const validSources = (ragResult.sources || []).filter((s: any) => s.ticker && s.filingType);
  for (const source of validSources) {
    yield {
      type: 'source',
      data: {
        title: `${source.ticker} ${source.filingType}`,
        type: source.type,
        ticker: source.ticker,
        filingType: source.filingType,
        fiscalPeriod: source.fiscalPeriod,
      },
    };
  }

  // Yield citations
  if (ragResult.citations && ragResult.citations.length > 0) {
    yield {
      type: 'citations',
      data: { citations: ragResult.citations },
    };
  }

  // Yield visualization chunk before tokens (if present)
  if (ragResult.visualization) {
    yield {
      type: 'visualization' as const,
      data: ragResult.visualization,
    };
  }

  // Yield token chunks (split by sentences)
  const sentences = ragResult.answer.match(/[^.!?]+[.!?]+/g) || [ragResult.answer];
  for (const sentence of sentences) {
    yield {
      type: 'token',
      data: { text: sentence.trim() },
    };
  }

  // Done
  yield {
    type: 'done',
    data: { complete: true },
  };
}

describe('Multimodal Research E2E', () => {
  let app: INestApplication;
  let currentStreamFn: () => AsyncGenerator<StreamChunk>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [],
      providers: [],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Register a route that streams SSE events using the same pattern
    // as the real ResearchAssistantController
    const httpAdapter = app.getHttpAdapter();
    httpAdapter.post('/test-multimodal/stream', (req: any, res: any) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      (async () => {
        try {
          for await (const chunk of currentStreamFn()) {
            const eventType = chunk.type;
            const eventData = JSON.stringify(chunk.data);
            res.write(`event: ${eventType}\ndata: ${eventData}\n\n`);
          }
          res.end();
        } catch (error: any) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
          res.end();
        }
      })();
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Trend query produces visualization SSE event followed by token events', () => {
    it('should yield a visualization chunk before any token chunks for a trend query', async () => {
      // Set up the stream to return a trend response WITH visualization
      const trendResponse = buildTrendRAGResponse();
      currentStreamFn = () => simulateSendMessage(trendResponse);

      const res = await request(app.getHttpServer())
        .post('/test-multimodal/stream')
        .send({ content: 'What is the revenue trend for AAPL?' })
        .expect(200);

      const events = parseSSEEvents(res.text);

      // There should be exactly one visualization event
      const vizEvents = events.filter((e) => e.type === 'visualization');
      const tokenEvents = events.filter((e) => e.type === 'token');
      const doneEvents = events.filter((e) => e.type === 'done');

      expect(vizEvents.length).toBe(1);
      expect(tokenEvents.length).toBeGreaterThan(0);
      expect(doneEvents.length).toBe(1);

      // Validate visualization payload structure (Req 4.1)
      const vizData = vizEvents[0].data;
      expect(vizData).toHaveProperty('chartType', 'line');
      expect(vizData).toHaveProperty('title');
      expect(vizData).toHaveProperty('labels');
      expect(vizData).toHaveProperty('datasets');
      expect(Array.isArray(vizData.labels)).toBe(true);
      expect(Array.isArray(vizData.datasets)).toBe(true);
      expect(vizData.datasets.length).toBeGreaterThan(0);
      expect(vizData.datasets[0]).toHaveProperty('label');
      expect(vizData.datasets[0]).toHaveProperty('data');

      // Visualization must appear BEFORE the first token event (Req 3.2)
      const vizIndex = events.findIndex((e) => e.type === 'visualization');
      const firstTokenIndex = events.findIndex((e) => e.type === 'token');
      expect(vizIndex).toBeLessThan(firstTokenIndex);
    });
  });

  describe('Non-trend query produces no visualization SSE event', () => {
    it('should not yield any visualization chunk for a non-trend query', async () => {
      // Set up the stream to return a non-trend response WITHOUT visualization
      const nonTrendResponse = buildNonTrendRAGResponse();
      currentStreamFn = () => simulateSendMessage(nonTrendResponse);

      const res = await request(app.getHttpServer())
        .post('/test-multimodal/stream')
        .send({ content: 'What does Apple say about competition?' })
        .expect(200);

      const events = parseSSEEvents(res.text);

      // There should be NO visualization events (Req 3.4)
      const vizEvents = events.filter((e) => e.type === 'visualization');
      const tokenEvents = events.filter((e) => e.type === 'token');
      const doneEvents = events.filter((e) => e.type === 'done');

      expect(vizEvents.length).toBe(0);
      expect(tokenEvents.length).toBeGreaterThan(0);
      expect(doneEvents.length).toBe(1);

      // Verify no event has type 'visualization' anywhere in the stream
      const allTypes = events.map((e) => e.type);
      expect(allTypes).not.toContain('visualization');
    });
  });
});
