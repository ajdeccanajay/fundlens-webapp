import {
  HybridSynthesisService,
  FinancialAnalysisContext,
  SynthesisResult,
  ResponseType,
  PeerComparisonResult,
  SubQueryResult,
} from '../../src/rag/hybrid-synthesis.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PerformanceOptimizerService } from '../../src/rag/performance-optimizer.service';
import {
  QueryIntent,
  MetricResult,
  ChunkResult,
  ResponseClassificationInput,
  classifyResponseType,
} from '../../src/rag/types/query-intent';
import { ComputedMetricResult } from '../../src/rag/metric-resolution/types';

// ── Test helpers ────────────────────────────────────────────────────

function makeIntent(overrides: Partial<QueryIntent> = {}): QueryIntent {
  return {
    type: 'hybrid',
    ticker: 'ABNB',
    metrics: ['revenue'],
    needsNarrative: true,
    needsComparison: false,
    needsComputation: false,
    needsTrend: false,
    confidence: 0.95,
    originalQuery: 'What is ABNB revenue and outlook?',
    ...overrides,
  };
}

function makeMetric(overrides: Partial<MetricResult> = {}): MetricResult {
  return {
    ticker: 'ABNB',
    normalizedMetric: 'revenue',
    rawLabel: 'Revenue',
    value: 8400000000,
    fiscalPeriod: 'FY2024',
    periodType: 'annual',
    filingType: '10-K',
    statementType: 'income_statement',
    statementDate: new Date('2024-12-31'),
    filingDate: new Date('2025-02-15'),
    confidenceScore: 0.95,
    displayName: 'Revenue',
    ...overrides,
  };
}

function makeNarrative(overrides: Partial<ChunkResult> = {}): ChunkResult {
  return {
    content: 'Management noted strong growth in international markets driven by experiences.',
    score: 0.88,
    metadata: {
      ticker: 'ABNB',
      documentType: '10-K',
      filingType: '10-K',
      sectionType: 'item_7',
      fiscalPeriod: 'FY2024',
      chunkIndex: 0,
    },
    ...overrides,
  };
}

function makeComputed(overrides: Partial<ComputedMetricResult> = {}): ComputedMetricResult {
  return {
    canonical_id: 'ebitda_margin',
    display_name: 'EBITDA Margin',
    value: 35.2,
    formula: 'ebitda / revenue * 100',
    resolved_inputs: {},
    explanation: null,
    audit_trail: null,
    interpretation: 'Strong (> 30%)',
    ...overrides,
  };
}

function makePeerData(overrides: Partial<PeerComparisonResult> = {}): PeerComparisonResult {
  return {
    metric: 'gross_profit_margin',
    normalizationBasis: 'FY',
    period: 'FY2024',
    rows: [
      { ticker: 'ABNB', value: 82.1, rank: 1 },
      { ticker: 'BKNG', value: 78.5, rank: 2 },
      { ticker: 'EXPE', value: 65.3, rank: 3 },
    ],
    median: 78.5,
    mean: 75.3,
    subjectTicker: 'ABNB',
    subjectRank: 1,
    subjectVsMedianPct: 4.6,
    ...overrides,
  };
}

function makeContext(overrides: Partial<FinancialAnalysisContext> = {}): FinancialAnalysisContext {
  return {
    originalQuery: 'What is ABNB revenue and outlook?',
    intent: makeIntent(),
    metrics: [makeMetric()],
    narratives: [makeNarrative()],
    computedResults: [],
    modelTier: 'sonnet',
    ...overrides,
  };
}

// ── Mock setup ──────────────────────────────────────────────────────

function createMocks() {
  const bedrockMock = {
    invokeClaude: jest.fn().mockResolvedValue(
      'STEP 1: Quantitative Facts\nABNB revenue was $8.4B in FY2024.\n\n' +
      'STEP 2: Narrative Summary\nManagement noted strong growth [1].\n\n' +
      'STEP 3: Reconciliation\nNumbers align with management commentary.\n\n' +
      'STEP 4: Conclusion\nABNB shows solid revenue growth.\n\n' +
      'STEP 5: Provocation\nCan ABNB sustain this growth rate?',
    ),
  } as unknown as BedrockService;

  const optimizerMock = {
    getModelId: jest.fn().mockReturnValue('us.anthropic.claude-3-5-sonnet-20241022-v2:0'),
  } as unknown as PerformanceOptimizerService;

  return { bedrockMock, optimizerMock };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('HybridSynthesisService', () => {
  let service: HybridSynthesisService;
  let bedrockMock: BedrockService;
  let optimizerMock: PerformanceOptimizerService;

  beforeEach(() => {
    const mocks = createMocks();
    bedrockMock = mocks.bedrockMock;
    optimizerMock = mocks.optimizerMock;
    service = new HybridSynthesisService(bedrockMock, optimizerMock);
  });

  describe('synthesize()', () => {
    it('should invoke Bedrock and return a SynthesisResult', async () => {
      const ctx = makeContext();
      const result = await service.synthesize(ctx);

      expect(result.answer).toContain('STEP 1');
      expect(result.answer).toContain('STEP 5');
      expect(result.responseType).toBe('HYBRID_SYNTHESIS');
      expect(bedrockMock.invokeClaude).toHaveBeenCalledTimes(1);
    });

    it('should use the correct model tier', async () => {
      const ctx = makeContext({ modelTier: 'opus' });
      await service.synthesize(ctx);

      expect(optimizerMock.getModelId).toHaveBeenCalledWith('opus');
    });

    it('should return fallback on Bedrock failure', async () => {
      (bedrockMock.invokeClaude as jest.Mock).mockRejectedValue(new Error('Bedrock timeout'));
      const ctx = makeContext();
      const result = await service.synthesize(ctx);

      expect(result.answer).toContain('Synthesis temporarily unavailable');
      expect(result.answer).toContain('Revenue');
      expect(result.citations).toEqual([]);
    });

    it('should use unifying prompt when subQueryResults present', async () => {
      const subQueryResults: SubQueryResult[] = [
        {
          subQuery: 'What is ABNB revenue?',
          metrics: [makeMetric()],
          narratives: [],
          computedResults: [],
          responseType: 'STRUCTURED_ONLY',
        },
      ];
      const ctx = makeContext({ subQueryResults });
      await service.synthesize(ctx);

      const prompt = (bedrockMock.invokeClaude as jest.Mock).mock.calls[0][0].prompt;
      expect(prompt).toContain('SUB-QUERY 1');
      expect(prompt).toContain('decomposed into sub-queries');
    });
  });

  describe('buildStructuredPrompt()', () => {
    it('should contain all 5 step markers', () => {
      const ctx = makeContext();
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('STEP 1: Quantitative Facts');
      expect(prompt).toContain('STEP 2: Narrative Summary');
      expect(prompt).toContain('STEP 3: Reconciliation');
      expect(prompt).toContain('STEP 4: Conclusion');
      expect(prompt).toContain('STEP 5: Provocation');
    });

    it('should include metrics table with ticker, value, period', () => {
      const ctx = makeContext();
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('ABNB');
      expect(prompt).toContain('Revenue');
      expect(prompt).toContain('FY2024');
      expect(prompt).toContain('$8.40B');
    });

    it('should include narrative attribution', () => {
      const ctx = makeContext();
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('ABNB | item_7 | FY2024');
      expect(prompt).toContain('strong growth in international markets');
    });

    it('should include peer comparison section when peerData present', () => {
      const ctx = makeContext({ peerData: makePeerData() });
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('PEER COMPARISON DATA');
      expect(prompt).toContain('BKNG');
      expect(prompt).toContain('EXPE');
      expect(prompt).toContain('Median');
    });

    it('should use peer-grounded provocation when peerData present', () => {
      const ctx = makeContext({ peerData: makePeerData() });
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('Peer-Grounded');
      expect(prompt).toContain('structural or cyclical');
    });

    it('should use standard provocation when no peerData', () => {
      const ctx = makeContext();
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).not.toContain('Peer-Grounded');
      expect(prompt).toContain('STEP 5: Provocation');
      expect(prompt).toContain('investment committee');
    });

    it('should inject PE tenant overlay when tenantId has overlay YAML', () => {
      const overlay = {
        tenant_id: 'third_avenue',
        display_name: 'Third Avenue Management',
        asset_class: 'private_equity',
        synthesis_instructions: 'Emphasize balance sheet protection and margin of safety.\nPrioritize free cash flow generation over revenue growth.',
        synonym_mappings: { distributable_cash: 'free_cash_flow' },
      };
      jest.spyOn(service, 'loadTenantOverlay').mockReturnValue(overlay);

      const ctx = makeContext({ tenantId: 'third_avenue' });
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('TENANT-SPECIFIC CONTEXT');
      expect(prompt).toContain('Third Avenue Management');
      expect(prompt).toContain('Private Equity');
      expect(prompt).toContain('balance sheet protection');
      expect(prompt).toContain('free cash flow generation');
    });

    it('should handle missing tenant overlay gracefully', () => {
      jest.spyOn(service, 'loadTenantOverlay').mockReturnValue(null);

      const ctx = makeContext({ tenantId: 'unknown_tenant' });
      const prompt = service.buildStructuredPrompt(ctx);

      // Should not crash, should not contain tenant section
      expect(prompt).not.toContain('TENANT-SPECIFIC CONTEXT');
      expect(prompt).toContain('STEP 1');
    });

    it('should not inject PE context when asset_class is not private_equity', () => {
      const overlay = {
        tenant_id: 'some_hedge_fund',
        display_name: 'Some Hedge Fund',
        asset_class: 'long_short_equity',
        synthesis_instructions: 'Focus on catalyst-driven analysis.',
      };
      jest.spyOn(service, 'loadTenantOverlay').mockReturnValue(overlay);

      const ctx = makeContext({ tenantId: 'some_hedge_fund' });
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('TENANT-SPECIFIC CONTEXT');
      expect(prompt).toContain('Some Hedge Fund');
      expect(prompt).not.toContain('Private Equity');
      expect(prompt).toContain('catalyst-driven analysis');
    });

    it('should handle empty metrics gracefully', () => {
      const ctx = makeContext({ metrics: [], computedResults: [] });
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).not.toContain('QUANTITATIVE DATA');
      expect(prompt).toContain('STEP 1');
    });

    it('should handle empty narratives gracefully', () => {
      const ctx = makeContext({ narratives: [] });
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).not.toContain('NARRATIVE CONTEXT');
      expect(prompt).toContain('STEP 2');
    });
  });

  describe('buildUnifyingPrompt()', () => {
    it('should reference sub-queries and include unifying instruction', () => {
      const ctx = makeContext({
        subQueryResults: [
          {
            subQuery: 'What is ABNB revenue?',
            metrics: [makeMetric()],
            narratives: [],
            computedResults: [],
            responseType: 'STRUCTURED_ONLY',
          },
          {
            subQuery: 'What does management say about growth?',
            metrics: [],
            narratives: [makeNarrative()],
            computedResults: [],
            responseType: 'NARRATIVE_ONLY',
          },
        ],
        unifyingInstruction: 'Combine quantitative revenue data with qualitative growth outlook.',
      });
      const prompt = service.buildUnifyingPrompt(ctx);

      expect(prompt).toContain('SUB-QUERY 1');
      expect(prompt).toContain('SUB-QUERY 2');
      expect(prompt).toContain('Combine quantitative revenue data');
      expect(prompt).toContain('STEP 1');
      expect(prompt).toContain('STEP 5');
    });
  });

  describe('formatMetricsTable()', () => {
    it('should format metrics into a markdown table', () => {
      const table = service.formatMetricsTable([makeMetric()], []);
      expect(table).toContain('| Ticker | Metric | Period | Value | Source |');
      expect(table).toContain('| ABNB | Revenue | FY2024 |');
    });

    it('should include computed results', () => {
      const table = service.formatMetricsTable([], [makeComputed()]);
      expect(table).toContain('EBITDA Margin');
      expect(table).toContain('35.20%');
    });

    it('should return null for empty inputs', () => {
      const table = service.formatMetricsTable([], []);
      expect(table).toBeNull();
    });
  });

  describe('formatPeerTable()', () => {
    it('should format peer data with ranks and statistics', () => {
      const table = service.formatPeerTable(makePeerData());
      expect(table).toContain('ABNB');
      expect(table).toContain('#1');
      expect(table).toContain('BKNG');
      expect(table).toContain('#2');
      expect(table).toContain('Median');
      expect(table).toContain('vs Median');
    });

    it('should include FY mismatch warning when present', () => {
      const table = service.formatPeerTable(
        makePeerData({ fyMismatchWarning: 'TRIP FY ends in March' }),
      );
      expect(table).toContain('⚠️ TRIP FY ends in March');
    });
  });

  describe('parseSynthesisResponse()', () => {
    it('should extract citations from [N] references', () => {
      const response = 'Revenue grew strongly [1] as noted in the filing.';
      const ctx = makeContext();
      const result = service.parseSynthesisResponse(response, ctx);

      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].id).toBe('citation-1');
      expect(result.citations[0].metadata.ticker).toBe('ABNB');
    });

    it('should deduplicate citation references', () => {
      const response = 'Revenue [1] grew [1] strongly.';
      const ctx = makeContext();
      const result = service.parseSynthesisResponse(response, ctx);

      expect(result.citations).toHaveLength(1);
    });

    it('should handle responses with no citations', () => {
      const response = 'Revenue grew strongly.';
      const ctx = makeContext();
      const result = service.parseSynthesisResponse(response, ctx);

      expect(result.citations).toHaveLength(0);
    });

    it('should classify responseType correctly', () => {
      // Hybrid (metrics + narratives)
      const hybrid = service.parseSynthesisResponse('test', makeContext());
      expect(hybrid.responseType).toBe('HYBRID_SYNTHESIS');

      // Structured only
      const structured = service.parseSynthesisResponse(
        'test',
        makeContext({ narratives: [], computedResults: [] }),
      );
      expect(structured.responseType).toBe('STRUCTURED_ONLY');

      // Narrative only
      const narrative = service.parseSynthesisResponse(
        'test',
        makeContext({ metrics: [], computedResults: [] }),
      );
      expect(narrative.responseType).toBe('NARRATIVE_ONLY');

      // Computed only
      const computed = service.parseSynthesisResponse(
        'test',
        makeContext({ metrics: [], narratives: [], computedResults: [makeComputed()] }),
      );
      expect(computed.responseType).toBe('COMPUTED_ONLY');

      // Decomposed
      const decomposed = service.parseSynthesisResponse(
        'test',
        makeContext({
          subQueryResults: [{
            subQuery: 'q1',
            metrics: [],
            narratives: [],
            computedResults: [],
            responseType: 'STRUCTURED_ONLY',
          }],
        }),
      );
      expect(decomposed.responseType).toBe('DECOMPOSED_HYBRID');

      // Peer comparison
      const peer = service.parseSynthesisResponse(
        'test',
        makeContext({ peerData: makePeerData() }),
      );
      expect(peer.responseType).toBe('PEER_COMPARISON');
    });
  });

  // ── Task 11.6: Grounded Provocation (Peer-Aware Step 5) ────────
  // Validates: Requirements 18.1, 18.2, 18.3
  describe('findMostInterestingDivergence()', () => {
    it('should find the peer with the largest gap from the subject', () => {
      const peerData = makePeerData({
        subjectTicker: 'ABNB',
        rows: [
          { ticker: 'ABNB', value: 82.1, rank: 1 },
          { ticker: 'BKNG', value: 78.5, rank: 2 },
          { ticker: 'EXPE', value: 65.3, rank: 3 },
          { ticker: 'TRIP', value: 55.0, rank: 4 },
        ],
      });

      const divergence = service.findMostInterestingDivergence(peerData);

      expect(divergence).not.toBeNull();
      expect(divergence!.peerTicker).toBe('TRIP'); // 82.1 - 55.0 = 27.1 (largest gap)
      expect(divergence!.peerValue).toBe(55.0);
      expect(divergence!.subjectValue).toBe(82.1);
      expect(divergence!.metric).toBe('gross_profit_margin');
      expect(divergence!.period).toBe('FY2024');
    });

    it('should return null when fewer than 2 rows', () => {
      const peerData = makePeerData({
        rows: [{ ticker: 'ABNB', value: 82.1, rank: 1 }],
      });
      expect(service.findMostInterestingDivergence(peerData)).toBeNull();
    });

    it('should return null when subjectTicker is missing', () => {
      const peerData = makePeerData({ subjectTicker: undefined });
      expect(service.findMostInterestingDivergence(peerData)).toBeNull();
    });

    it('should return null when subject has null value', () => {
      const peerData = makePeerData({
        subjectTicker: 'ABNB',
        rows: [
          { ticker: 'ABNB', value: null, rank: 3 },
          { ticker: 'BKNG', value: 78.5, rank: 1 },
        ],
      });
      expect(service.findMostInterestingDivergence(peerData)).toBeNull();
    });

    it('should skip peers with null values', () => {
      const peerData = makePeerData({
        subjectTicker: 'ABNB',
        rows: [
          { ticker: 'ABNB', value: 82.1, rank: 1 },
          { ticker: 'BKNG', value: null, rank: 2 },
          { ticker: 'EXPE', value: 65.3, rank: 3 },
        ],
      });

      const divergence = service.findMostInterestingDivergence(peerData);
      expect(divergence).not.toBeNull();
      expect(divergence!.peerTicker).toBe('EXPE');
    });

    it('should return null when all peers have null values', () => {
      const peerData = makePeerData({
        subjectTicker: 'ABNB',
        rows: [
          { ticker: 'ABNB', value: 82.1, rank: 1 },
          { ticker: 'BKNG', value: null, rank: 2 },
          { ticker: 'EXPE', value: null, rank: 3 },
        ],
      });
      expect(service.findMostInterestingDivergence(peerData)).toBeNull();
    });
  });

  describe('buildStructuredPrompt() — peer-grounded provocation (Req 18.1–18.3)', () => {
    it('should include concrete divergence data in Step 5 when peerData has subject and peers (Req 18.2)', () => {
      const ctx = makeContext({
        peerData: makePeerData({
          subjectTicker: 'ABNB',
          metric: 'gross_profit_margin',
          period: 'FY2024',
          rows: [
            { ticker: 'ABNB', value: 82.1, rank: 1 },
            { ticker: 'BKNG', value: 78.5, rank: 2 },
            { ticker: 'EXPE', value: 65.3, rank: 3 },
          ],
        }),
      });
      const prompt = service.buildStructuredPrompt(ctx);

      // Should reference the specific divergence (EXPE has largest gap: 82.1 - 65.3 = 16.8)
      expect(prompt).toContain('EXPE');
      expect(prompt).toContain('ABNB');
      expect(prompt).toContain('65.30%');
      expect(prompt).toContain('82.10%');
      expect(prompt).toContain('FY2024');
      expect(prompt).toContain('structural or cyclical');
    });

    it('should follow the exact format from Req 18.3', () => {
      const ctx = makeContext({
        peerData: makePeerData({
          subjectTicker: 'ABNB',
          metric: 'revenue',
          period: 'FY2024',
          rows: [
            { ticker: 'ABNB', value: 8400000000, rank: 2 },
            { ticker: 'BKNG', value: 21000000000, rank: 1 },
          ],
        }),
      });
      const prompt = service.buildStructuredPrompt(ctx);

      // Format: "Given that [PEER] achieved [X] while [SUBJECT] achieved [Y] in [PERIOD], ..."
      expect(prompt).toMatch(/Given that BKNG achieved .+ while ABNB achieved .+ in FY2024, what explains the gap and is it structural or cyclical\?/);
    });

    it('should fall back to generic peer-grounded template when divergence cannot be computed', () => {
      const ctx = makeContext({
        peerData: makePeerData({
          subjectTicker: undefined, // No subject → can't compute divergence
          rows: [
            { ticker: 'ABNB', value: 82.1, rank: 1 },
            { ticker: 'BKNG', value: 78.5, rank: 2 },
          ],
        }),
      });
      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('Peer-Grounded');
      expect(prompt).toContain('Pose a challenge question grounded in a specific divergence');
      expect(prompt).toContain('structural or cyclical');
    });
  });

  describe('buildUnifyingPrompt() — peer-grounded provocation (Req 18.1)', () => {
    it('should use peer-grounded Step 5 when peerData present in unifying prompt', () => {
      const ctx = makeContext({
        subQueryResults: [
          {
            subQuery: 'What is ABNB revenue?',
            metrics: [makeMetric()],
            narratives: [],
            computedResults: [],
            responseType: 'STRUCTURED_ONLY',
          },
        ],
        peerData: makePeerData({
          subjectTicker: 'ABNB',
          metric: 'gross_profit_margin',
          period: 'FY2024',
          rows: [
            { ticker: 'ABNB', value: 82.1, rank: 1 },
            { ticker: 'EXPE', value: 65.3, rank: 3 },
          ],
        }),
      });
      const prompt = service.buildUnifyingPrompt(ctx);

      expect(prompt).toContain('Peer-Grounded');
      expect(prompt).toContain('EXPE');
      expect(prompt).toContain('structural or cyclical');
    });

    it('should use standard provocation in unifying prompt when no peerData', () => {
      const ctx = makeContext({
        subQueryResults: [
          {
            subQuery: 'What is ABNB revenue?',
            metrics: [makeMetric()],
            narratives: [],
            computedResults: [],
            responseType: 'STRUCTURED_ONLY',
          },
        ],
      });
      const prompt = service.buildUnifyingPrompt(ctx);

      expect(prompt).not.toContain('Peer-Grounded');
      expect(prompt).toContain('STEP 5: Provocation');
      expect(prompt).toContain('combined evidence');
    });
  });

  // ── T2.1: Hybrid query → HYBRID_SYNTHESIS with 5 steps ─────────
  // Validates: Requirements 8.2, 9.4
  describe('T2.1: hybrid query → responseType HYBRID_SYNTHESIS, answer contains all 5 steps', () => {
    it('buildStructuredPrompt() should contain all 5 step markers for a hybrid context', () => {
      const ctx = makeContext({
        originalQuery: 'What is ABNB revenue and what does management say about growth?',
        intent: makeIntent({ type: 'hybrid', needsNarrative: true }),
        metrics: [makeMetric()],
        narratives: [makeNarrative()],
        computedResults: [],
        // No peerData, no subQueryResults
      });

      const prompt = service.buildStructuredPrompt(ctx);

      expect(prompt).toContain('STEP 1');
      expect(prompt).toContain('STEP 2');
      expect(prompt).toContain('STEP 3');
      expect(prompt).toContain('STEP 4');
      expect(prompt).toContain('STEP 5');
    });

    it('classifyResponseType() should return HYBRID_SYNTHESIS for metrics + narratives context', () => {
      const input: ResponseClassificationInput = {
        intent: makeIntent({ type: 'hybrid', needsNarrative: true }),
        metrics: [makeMetric()],
        narratives: [makeNarrative()],
        computedResults: [],
        // No peerData, no subQueryResults, no conceptMatchId
      };

      expect(classifyResponseType(input)).toBe('HYBRID_SYNTHESIS');
    });
  });

  // ── T2.2: "How levered is ABNB?" → CONCEPT_ANALYSIS ────────────
  // Validates: Requirements 9.6
  describe('T2.2: "How levered is ABNB?" → responseType CONCEPT_ANALYSIS', () => {
    it('classifyResponseType() should return CONCEPT_ANALYSIS when conceptMatchId is set', () => {
      const input: ResponseClassificationInput = {
        intent: makeIntent({
          type: 'hybrid',
          originalQuery: 'How levered is ABNB?',
          ticker: 'ABNB',
          metrics: ['debt_to_equity', 'net_debt_to_ebitda'],
          needsNarrative: true,
        }),
        metrics: [makeMetric({ normalizedMetric: 'debt_to_equity', value: 1.8 })],
        narratives: [makeNarrative()],
        computedResults: [],
        conceptMatchId: 'leverage',
      };

      expect(classifyResponseType(input)).toBe('CONCEPT_ANALYSIS');
    });

    it('CONCEPT_ANALYSIS should take priority over HYBRID_SYNTHESIS when conceptMatchId is present', () => {
      // Even with both metrics and narratives, conceptMatchId should win
      const input: ResponseClassificationInput = {
        intent: makeIntent({ type: 'hybrid', needsNarrative: true }),
        metrics: [makeMetric()],
        narratives: [makeNarrative()],
        computedResults: [makeComputed()],
        conceptMatchId: 'leverage',
      };

      expect(classifyResponseType(input)).toBe('CONCEPT_ANALYSIS');
    });
  });
});
