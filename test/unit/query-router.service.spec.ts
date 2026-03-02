import { Test, TestingModule } from '@nestjs/testing';
import { QueryRouterService } from 'src/rag/query-router.service';
import { IntentDetectorService } from 'src/rag/intent-detector.service';
import { MetricRegistryService } from 'src/rag/metric-resolution/metric-registry.service';
import { ConceptRegistryService } from 'src/rag/metric-resolution/concept-registry.service';
import { MetricResolution } from 'src/rag/metric-resolution/types';

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

import * as fs from 'fs';

describe('QueryRouterService', () => {
  let service: QueryRouterService;
  let intentDetector: jest.Mocked<IntentDetectorService>;
  let metricRegistry: jest.Mocked<MetricRegistryService>;
  let conceptRegistry: jest.Mocked<ConceptRegistryService>;

  const makeResolution = (overrides: Partial<MetricResolution> = {}): MetricResolution => ({
    canonical_id: 'total_revenue',
    display_name: 'Total Revenue',
    type: 'atomic',
    confidence: 'exact',
    fuzzy_score: null,
    original_query: 'revenue',
    match_source: 'synonym_index',
    suggestions: null,
    db_column: 'total_revenue',
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueryRouterService,
        {
          provide: IntentDetectorService,
          useValue: {
            detectIntent: jest.fn(),
          },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            resolve: jest.fn(),
            resolveMultiple: jest.fn(),
          },
        },
        {
          provide: ConceptRegistryService,
          useValue: {
            matchConcept: jest.fn().mockReturnValue(null),
            getMetricBundle: jest.fn().mockReturnValue(null),
          },
        },
      ],
    }).compile();

    service = module.get(QueryRouterService);
    intentDetector = module.get(IntentDetectorService) as any;
    metricRegistry = module.get(MetricRegistryService) as any;
    conceptRegistry = module.get(ConceptRegistryService) as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('structured query routing', () => {
    it('should resolve metrics via MetricRegistryService for structured queries', async () => {
      const revenueResolution = makeResolution();
      const ebitdaResolution = makeResolution({
        canonical_id: 'ebitda',
        display_name: 'EBITDA',
        db_column: 'ebitda',
        original_query: 'EBITDA',
      });

      metricRegistry.resolveMultiple.mockReturnValue([revenueResolution, ebitdaResolution]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['revenue', 'EBITDA'],
        period: 'FY2024',
        periodType: 'annual',
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.95,
        originalQuery: 'What is AAPL revenue and EBITDA for FY2024?',
      });

      const plan = await service.route('What is AAPL revenue and EBITDA for FY2024?');

      expect(plan.useStructured).toBe(true);
      expect(plan.useSemantic).toBe(true); // Always-on semantic for MD&A context
      expect(plan.structuredQuery?.metrics).toEqual([revenueResolution, ebitdaResolution]);
      expect(metricRegistry.resolveMultiple).toHaveBeenCalledWith(['revenue', 'EBITDA'], undefined);
    });

    it('should use db_column from atomic MetricResolution', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({
          canonical_id: 'cash_and_cash_equivalents',
          db_column: 'cash_and_cash_equivalents',
          original_query: 'cash',
        }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'MSFT',
        metrics: ['cash'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.9,
        originalQuery: 'MSFT cash',
      });

      const plan = await service.route('MSFT cash');
      expect(plan.structuredQuery?.metrics).toEqual([
        makeResolution({
          canonical_id: 'cash_and_cash_equivalents',
          db_column: 'cash_and_cash_equivalents',
          original_query: 'cash',
        }),
      ]);
    });
  });

  describe('computed metric handling', () => {
    it('should use canonical_id for computed metrics (no db_column)', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({
          canonical_id: 'gross_margin',
          display_name: 'Gross Margin',
          type: 'computed',
          confidence: 'exact',
          original_query: 'gross margin',
          db_column: undefined,
          formula: 'gross_profit / revenue * 100',
          dependencies: ['gross_profit', 'total_revenue'],
        }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['gross margin'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: true,
        needsTrend: false,
        confidence: 0.9,
        originalQuery: 'AAPL gross margin',
      });

      const plan = await service.route('AAPL gross margin');
      expect(plan.structuredQuery?.metrics).toEqual([
        makeResolution({
          canonical_id: 'gross_margin',
          display_name: 'Gross Margin',
          type: 'computed',
          confidence: 'exact',
          original_query: 'gross margin',
          db_column: undefined,
          formula: 'gross_profit / revenue * 100',
          dependencies: ['gross_profit', 'total_revenue'],
        }),
      ]);
    });
  });

  describe('unresolved metric handling', () => {
    it('should fall back to original query string for unresolved metrics', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({
          canonical_id: '',
          display_name: '',
          type: 'atomic',
          confidence: 'unresolved',
          original_query: 'some_unknown_metric',
          db_column: undefined,
          match_source: 'none',
          suggestions: null,
        }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['some_unknown_metric'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.5,
        originalQuery: 'AAPL some_unknown_metric',
      });

      const plan = await service.route('AAPL some_unknown_metric');
      expect(plan.structuredQuery?.metrics).toEqual([
        makeResolution({
          canonical_id: '',
          display_name: '',
          type: 'atomic',
          confidence: 'unresolved',
          original_query: 'some_unknown_metric',
          db_column: undefined,
          match_source: 'none',
          suggestions: null,
        }),
      ]);
    });
  });

  describe('hybrid query routing', () => {
    it('should resolve metrics via MetricRegistryService for hybrid queries', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ db_column: 'total_revenue', original_query: 'revenue' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'hybrid',
        ticker: 'GOOG',
        metrics: ['revenue'],
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.85,
        originalQuery: 'What drove Google revenue growth?',
      });

      const plan = await service.route('What drove Google revenue growth?');

      expect(plan.useStructured).toBe(true);
      expect(plan.useSemantic).toBe(true);
      expect(plan.structuredQuery?.metrics).toEqual([
        makeResolution({ db_column: 'total_revenue', original_query: 'revenue' }),
      ]);
      expect(plan.semanticQuery).toBeDefined();
      expect(metricRegistry.resolveMultiple).toHaveBeenCalledWith(['revenue'], undefined);
    });
  });

  describe('semantic query routing', () => {
    it('should not call MetricRegistryService for pure semantic queries', async () => {
      intentDetector.detectIntent.mockResolvedValue({
        type: 'semantic',
        ticker: 'AAPL',
        metrics: [],
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.9,
        originalQuery: 'What are the risk factors for Apple?',
        sectionTypes: ['risk_factors'],
      });

      const plan = await service.route('What are the risk factors for Apple?');

      expect(plan.useStructured).toBe(false);
      expect(plan.useSemantic).toBe(true);
      expect(metricRegistry.resolveMultiple).not.toHaveBeenCalled();
    });
  });

  describe('empty metrics handling', () => {
    it('should handle empty metrics array gracefully', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'AAPL',
        metrics: [],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.8,
        originalQuery: 'AAPL financials',
      });

      const plan = await service.route('AAPL financials');
      expect(plan.structuredQuery?.metrics).toEqual([]);
      expect(metricRegistry.resolveMultiple).toHaveBeenCalledWith([], undefined);
    });
  });

  describe('atomic metric fallback to canonical_id', () => {
    it('should use canonical_id when db_column is undefined for atomic metrics', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({
          canonical_id: 'arr',
          display_name: 'Annual Recurring Revenue',
          type: 'atomic',
          confidence: 'exact',
          original_query: 'ARR',
          db_column: undefined,
        }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'CRM',
        metrics: ['ARR'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.9,
        originalQuery: 'CRM ARR',
      });

      const plan = await service.route('CRM ARR');
      // Falls back to canonical_id when db_column is undefined
      expect(plan.structuredQuery?.metrics).toEqual([
        makeResolution({
          canonical_id: 'arr',
          display_name: 'Annual Recurring Revenue',
          type: 'atomic',
          confidence: 'exact',
          original_query: 'ARR',
          db_column: undefined,
        }),
      ]);
    });
  });

  describe('concept routing', () => {
    it('should route concept queries to buildConceptPlan', async () => {
      conceptRegistry.matchConcept.mockReturnValue({
        concept_id: 'leverage',
        display_name: 'Leverage Analysis',
        confidence: 'exact',
        fuzzy_score: null,
        matched_trigger: 'how levered',
      });

      conceptRegistry.getMetricBundle.mockReturnValue({
        concept_id: 'leverage',
        display_name: 'Leverage Analysis',
        primary_metrics: ['net_debt_to_ebitda', 'debt_to_equity', 'interest_coverage'],
        secondary_metrics: ['total_debt', 'net_debt'],
        context_prompt: 'Summarize leverage discussion from filings.',
        presentation: { layout: 'profile', include_peer_comparison: true, include_historical_trend: true },
      });

      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ canonical_id: 'net_debt_to_ebitda', display_name: 'Net Debt/EBITDA', type: 'computed' }),
        makeResolution({ canonical_id: 'debt_to_equity', display_name: 'Debt to Equity', type: 'computed' }),
        makeResolution({ canonical_id: 'interest_coverage', display_name: 'Interest Coverage', type: 'computed' }),
        makeResolution({ canonical_id: 'total_debt', display_name: 'Total Debt', db_column: 'total_debt' }),
        makeResolution({ canonical_id: 'net_debt', display_name: 'Net Debt', type: 'computed' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'semantic',
        ticker: 'AAPL',
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.8,
        originalQuery: 'How levered is AAPL?',
      });

      const plan = await service.route('How levered is AAPL?');

      expect(plan.useStructured).toBe(true);
      expect(plan.useSemantic).toBe(true);
      expect(plan.structuredQuery?.metrics).toHaveLength(5);
      expect(plan.structuredQuery?.includeComputed).toBe(true);
      expect(plan.semanticQuery?.query).toContain('leverage');
    });

    it('should fall back to standard routing when concept has no bundle', async () => {
      conceptRegistry.matchConcept.mockReturnValue({
        concept_id: 'unknown_concept',
        display_name: 'Unknown',
        confidence: 'exact',
        fuzzy_score: null,
        matched_trigger: 'unknown',
      });

      conceptRegistry.getMetricBundle.mockReturnValue(null);

      metricRegistry.resolveMultiple.mockReturnValue([]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'semantic',
        ticker: 'AAPL',
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.8,
        originalQuery: 'unknown concept query',
      });

      const plan = await service.route('unknown concept query');
      // Falls back to hybrid plan
      expect(plan.useStructured).toBe(true);
      expect(plan.useSemantic).toBe(true);
    });

    it('should not match concepts for non-concept queries', async () => {
      conceptRegistry.matchConcept.mockReturnValue(null);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        confidence: 0.95,
        originalQuery: 'AAPL revenue FY2024',
      });

      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution(),
      ]);

      const plan = await service.route('AAPL revenue FY2024');
      expect(conceptRegistry.matchConcept).toHaveBeenCalledWith('AAPL revenue FY2024');
      expect(plan.useStructured).toBe(true);
      expect(plan.useSemantic).toBe(true); // Always-on semantic for MD&A context
    });
  });

  describe('peer universe resolution (Req 17.1, 17.2, 17.3)', () => {
    const mockYaml = `
online_travel:
  display_name: Online Travel & Experiences
  gics_subindustry: Internet & Direct Marketing Retail
  members: [ABNB, BKNG, EXPE, TRIP]
  primary_metrics: [revenue, gross_profit_margin, take_rate]
  normalization_basis: LTM

us_mega_cap_tech:
  display_name: US Mega-Cap Technology
  members: [AAPL, MSFT, GOOGL, AMZN, META, NVDA]
  primary_metrics: [revenue, operating_income_margin]
  normalization_basis: FY
`;

    beforeEach(() => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(mockYaml);
      service.loadPeerUniverses();
    });

    afterEach(() => {
      (fs.existsSync as jest.Mock).mockReset();
      (fs.readFileSync as jest.Mock).mockReset();
    });

    it('should expand single ticker to peer universe when needsPeerComparison is true (Req 17.1, 17.2)', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ canonical_id: 'revenue', original_query: 'revenue' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'ABNB',
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: true,
        confidence: 0.9,
        originalQuery: 'How does ABNB compare to peers on revenue?',
      });

      const plan = await service.route('How does ABNB compare to peers on revenue?');

      // Tickers should be expanded to all online_travel members
      expect(plan.structuredQuery?.tickers).toEqual(['ABNB', 'BKNG', 'EXPE', 'TRIP']);
    });

    it('should not expand tickers when needsPeerComparison is false', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ canonical_id: 'revenue', original_query: 'revenue' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'ABNB',
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: false,
        confidence: 0.9,
        originalQuery: 'ABNB revenue FY2024',
      });

      const plan = await service.route('ABNB revenue FY2024');

      expect(plan.structuredQuery?.tickers).toEqual(['ABNB']);
    });

    it('should not expand when multiple tickers already provided', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ canonical_id: 'revenue', original_query: 'revenue' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: ['ABNB', 'BKNG'],
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: true,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: true,
        confidence: 0.9,
        originalQuery: 'Compare ABNB vs BKNG revenue',
      });

      const plan = await service.route('Compare ABNB vs BKNG revenue');

      // Should keep the original 2 tickers, not expand to full universe
      expect(plan.structuredQuery?.tickers).toEqual(['ABNB', 'BKNG']);
    });

    it('should not expand when ticker has no peer universe', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ canonical_id: 'revenue', original_query: 'revenue' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'TSLA',
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: true,
        confidence: 0.9,
        originalQuery: 'How does TSLA compare to peers?',
      });

      const plan = await service.route('How does TSLA compare to peers?');

      // TSLA is not in any peer universe, should stay as single ticker
      expect(plan.structuredQuery?.tickers).toEqual(['TSLA']);
    });

    it('should log universe name and member tickers on resolution (Req 17.3)', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');

      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ canonical_id: 'revenue', original_query: 'revenue' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'MSFT',
        metrics: ['revenue'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: true,
        confidence: 0.9,
        originalQuery: 'How does MSFT compare to peers?',
      });

      await service.route('How does MSFT compare to peers?');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('PEER UNIVERSE RESOLVED'),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('us_mega_cap_tech'),
      );
    });

    it('should resolve AAPL to us_mega_cap_tech universe', async () => {
      metricRegistry.resolveMultiple.mockReturnValue([
        makeResolution({ canonical_id: 'operating_income_margin', original_query: 'margins' }),
      ]);

      intentDetector.detectIntent.mockResolvedValue({
        type: 'structured',
        ticker: 'AAPL',
        metrics: ['margins'],
        needsNarrative: false,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
        needsPeerComparison: true,
        confidence: 0.9,
        originalQuery: 'How does AAPL compare to peers on margins?',
      });

      const plan = await service.route('How does AAPL compare to peers on margins?');

      expect(plan.structuredQuery?.tickers).toEqual(['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA']);
    });

    describe('lookupPeerUniverse', () => {
      it('should return universe for known ticker', () => {
        const result = service.lookupPeerUniverse('ABNB');
        expect(result).toBeDefined();
        expect(result!.name).toBe('online_travel');
        expect(result!.universe.display_name).toBe('Online Travel & Experiences');
        expect(result!.universe.members).toEqual(['ABNB', 'BKNG', 'EXPE', 'TRIP']);
      });

      it('should return undefined for unknown ticker', () => {
        const result = service.lookupPeerUniverse('TSLA');
        expect(result).toBeUndefined();
      });
    });
  });
});
