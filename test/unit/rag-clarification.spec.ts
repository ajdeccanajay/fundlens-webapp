import { Test, TestingModule } from '@nestjs/testing';
import { RAGService } from '../../src/rag/rag.service';
import { QueryRouterService } from '../../src/rag/query-router.service';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { SemanticRetrieverService } from '../../src/rag/semantic-retriever.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { DocumentRAGService } from '../../src/rag/document-rag.service';
import { ComputedMetricsService } from '../../src/dataSources/sec/computed-metrics.service';
import { PerformanceMonitorService } from '../../src/rag/performance-monitor.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import { QueryIntent } from '../../src/rag/types/query-intent';

/**
 * Unit tests for RAG Service - Clarification Prompt Generation (Phase 3)
 * 
 * Tests the clarification prompt generation feature for ambiguous queries.
 * Validates Requirements 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.7
 */
describe('RAGService - Clarification Prompt Generation', () => {
  let service: RAGService;
  let queryRouter: QueryRouterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        {
          provide: QueryRouterService,
          useValue: {
            route: jest.fn(),
            getIntent: jest.fn(),
          },
        },
        {
          provide: StructuredRetrieverService,
          useValue: {},
        },
        {
          provide: SemanticRetrieverService,
          useValue: {},
        },
        {
          provide: BedrockService,
          useValue: {},
        },
        {
          provide: DocumentRAGService,
          useValue: {},
        },
        {
          provide: ComputedMetricsService,
          useValue: {},
        },
        {
          provide: PerformanceMonitorService,
          useValue: {
            recordQuery: jest.fn(),
          },
        },
        {
          provide: PerformanceOptimizerService,
          useValue: {
            makeOptimizationDecisions: jest.fn().mockReturnValue({
              useCache: false,
              parallelExecution: false,
              maxTokens: 4000,
              modelTier: 'haiku',
              reasoning: [],
            }),
            shouldUseLLM: jest.fn().mockReturnValue(false),
            enforceTokenBudget: jest.fn((narratives) => narratives),
          },
        },
      ],
    }).compile();

    service = module.get<RAGService>(RAGService);
    queryRouter = module.get<QueryRouterService>(QueryRouterService);
  });

  describe('Clarification Prompt Generation', () => {
    it('should generate clarification prompt for ambiguous query', async () => {
      // Arrange
      const query = 'Tell me about NVDA';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'NVDA',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
        ambiguityReason: 'Ticker-only query with generic words',
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert
      expect(response.answer).toContain('What would you like to know?');
      expect(response.answer).toContain('NVDA');
      expect(response.processingInfo?.needsClarification).toBe(true);
      expect(response.latency).toBe(0); // Clarification is instant
      expect(response.cost).toBe(0); // No LLM cost
    });

    it('should include all 8 suggestion categories in clarification prompt', async () => {
      // Arrange
      const query = 'Show me MSFT';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'MSFT',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - All 8 categories must be present
      expect(response.answer).toContain('Financial Performance');
      expect(response.answer).toContain('Business & Strategy');
      expect(response.answer).toContain('Comparative Analysis');
      expect(response.answer).toContain('Risk & Quality');
      expect(response.answer).toContain('Forward-Looking');
      expect(response.answer).toContain('Valuation');
      expect(response.answer).toContain('Industry-Specific');
      expect(response.answer).toContain('ESG & Sustainability');
    });

    it('should include Financial Performance subcategories', async () => {
      // Arrange
      const query = 'Give me information on AAPL';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'AAPL',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Financial Performance has 3 subcategories
      expect(response.answer).toContain('Revenue & Growth');
      expect(response.answer).toContain('Profitability');
      expect(response.answer).toContain('Balance Sheet');
    });

    it('should include tech industry-specific queries for NVDA', async () => {
      // Arrange
      const query = 'Tell me about NVDA';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'NVDA',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Tech-specific queries
      expect(response.answer).toContain("NVDA's R&D spending");
      expect(response.answer).toContain("NVDA's chip architecture roadmap");
      expect(response.answer).toContain("NVDA's process node migration");
      expect(response.answer).toContain("NVDA's ASP trends");
    });

    it('should include SaaS industry-specific queries for CRM', async () => {
      // Arrange
      const query = 'Show me CRM';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'CRM',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - SaaS-specific queries
      expect(response.answer).toContain("CRM's ARR growth");
      expect(response.answer).toContain("CRM's net retention rate");
      expect(response.answer).toContain("CRM's customer acquisition cost");
      expect(response.answer).toContain("CRM's churn rate");
    });

    it('should include retail industry-specific queries for AMZN', async () => {
      // Arrange
      const query = 'Tell me about AMZN';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'AMZN',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Retail-specific queries
      expect(response.answer).toContain("AMZN's same-store sales growth");
      expect(response.answer).toContain("AMZN's e-commerce penetration");
      expect(response.answer).toContain("AMZN's fulfillment costs");
      expect(response.answer).toContain("AMZN's inventory turns");
    });

    it('should include healthcare industry-specific queries for JNJ', async () => {
      // Arrange
      const query = 'Give me info on JNJ';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'JNJ',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Healthcare-specific queries
      expect(response.answer).toContain("JNJ's drug pipeline");
      expect(response.answer).toContain("JNJ's patent expirations");
      expect(response.answer).toContain("JNJ's clinical trial results");
      expect(response.answer).toContain("JNJ's regulatory approvals");
    });

    it('should include quick actions in clarification prompt', async () => {
      // Arrange
      const query = 'Tell me about GOOGL';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'GOOGL',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Quick actions
      expect(response.answer).toContain('Quick Actions:');
      expect(response.answer).toContain("View GOOGL's financial dashboard");
      expect(response.answer).toContain("Read GOOGL's latest 10-K");
      expect(response.answer).toContain("See GOOGL's key metrics");
    });

    it('should handle missing ticker gracefully', async () => {
      // Arrange
      const query = 'Tell me about something';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: undefined,
        confidence: 0.5,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Fallback message
      expect(response.answer).toContain('I need more information to help you');
      expect(response.answer).toContain('Please specify a company ticker symbol');
      expect(response.processingInfo?.needsClarification).toBe(true);
    });

    it('should handle array ticker (use first ticker)', async () => {
      // Arrange
      const query = 'Tell me about NVDA and AMD';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: ['NVDA', 'AMD'],
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Uses first ticker
      expect(response.answer).toContain('NVDA');
      expect(response.answer).toContain('What would you like to know?');
    });

    it('should include category icons in clarification prompt', async () => {
      // Arrange
      const query = 'Show me TSLA';
      const ambiguousIntent: QueryIntent = {
        type: 'semantic',
        ticker: 'TSLA',
        confidence: 0.7,
        originalQuery: query,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: true,
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: false,
        useSemantic: true,
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(ambiguousIntent);

      // Act
      const response = await service.query(query);

      // Assert - Icons present
      expect(response.answer).toContain('💰'); // Financial Performance
      expect(response.answer).toContain('🏢'); // Business & Strategy
      expect(response.answer).toContain('📊'); // Comparative Analysis
      expect(response.answer).toContain('⚠️'); // Risk & Quality
      expect(response.answer).toContain('🔮'); // Forward-Looking
      expect(response.answer).toContain('💵'); // Valuation
      expect(response.answer).toContain('🔬'); // Industry-Specific
      expect(response.answer).toContain('🌱'); // ESG & Sustainability
    });
  });

  describe('Non-Ambiguous Queries', () => {
    it('should NOT generate clarification prompt for specific metric query', async () => {
      // Arrange
      const query = 'NVDA revenue';
      const specificIntent: QueryIntent = {
        type: 'structured',
        ticker: 'NVDA',
        metrics: ['Revenue'],
        confidence: 0.9,
        originalQuery: query,
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsClarification: false, // NOT ambiguous
      };

      jest.spyOn(queryRouter, 'route').mockResolvedValue({
        useStructured: true,
        useSemantic: false,
        structuredQuery: {
          tickers: ['NVDA'],
          metrics: ['Revenue'],
          filingTypes: ['10-K', '10-Q'],
          includeComputed: false,
        },
      } as any);
      jest.spyOn(queryRouter, 'getIntent').mockResolvedValue(specificIntent);

      // Mock structured retriever to return empty results
      const structuredRetriever = service['structuredRetriever'];
      structuredRetriever.retrieve = jest.fn().mockResolvedValue({ metrics: [] });

      // Act
      const response = await service.query(query);

      // Assert - Should NOT be a clarification prompt
      expect(response.processingInfo?.needsClarification).toBeUndefined();
      expect(response.answer).not.toContain('What would you like to know?');
    });
  });
});
