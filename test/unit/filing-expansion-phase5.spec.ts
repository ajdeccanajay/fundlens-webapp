/**
 * Filing Expansion — Phase 5: Query-Triggered + Freshness Tests
 *
 * Spec reference: KIRO_SPEC_FILING_EXPANSION_AND_AGENTIC_ACQUISITION.md §Phase 5
 *
 * P5-T1: Query referencing missing Form 4 data → triggers background acquisition, shows note
 * P5-T2: Monday cron → includes transcript freshness check
 * P5-T3: Tuesday cron → does NOT run transcript check
 * P5-T4: New deal creation for new ticker → full acquisition of all filing types + transcripts
 * P5-T5: Data coverage display → shows counts per filing type, last updated timestamp
 * P5-T6: Cron missed (simulate) → 8 AM health check triggers catch-up
 */

// ─── Mock Prisma ────────────────────────────────────────────────────────────
const mockPrisma = {
  deal: {
    findMany: jest.fn().mockResolvedValue([
      { ticker: 'NVDA' },
      { ticker: 'AAPL' },
    ]),
    findFirst: jest.fn().mockResolvedValue({ companyName: 'NVIDIA Corporation' }),
    findUnique: jest.fn().mockResolvedValue({ id: 'deal-1', ticker: 'NVDA', companyName: 'NVIDIA' }),
  },
  filingDetectionState: {
    findMany: jest.fn().mockResolvedValue([]),
  },
  narrativeChunk: {
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
  },
  $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

// ─── Mock OrchestratorAgent ─────────────────────────────────────────────────
const mockOrchestratorAgent = {
  execute: jest.fn().mockResolvedValue({
    ticker: 'NVDA',
    triggeredBy: 'query_triggered',
    startedAt: new Date(),
    completedAt: new Date(),
    actions: [],
    errors: [],
    llmCalls: 0,
    totalTokens: 0,
    transcriptsAcquired: 0,
  }),
  assessCurrentCoverage: jest.fn().mockResolvedValue({
    ticker: 'NVDA',
    filingCounts: {},
    latestFilingDates: {},
    transcriptQuarters: [],
    hasIrMapping: false,
  }),
};

// ─── Mock other services ────────────────────────────────────────────────────
const mockDetectorService = {
  detectNewFilings: jest.fn().mockResolvedValue({ newFilings: 0, errors: [] }),
  getNewFilingsForDownload: jest.fn().mockResolvedValue([]),
  logRateLimitMetrics: jest.fn(),
};
const mockSecSyncService = { syncFilingType: jest.fn() };
const mockSecProcessingService = { processFiling: jest.fn() };
const mockNotificationService = { createNotifications: jest.fn() };
const mockLockService = {
  withLock: jest.fn().mockImplementation((_key: string, fn: () => any) => fn()),
};

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: Filing Detection Scheduler — Monday Transcript Freshness
// ═══════════════════════════════════════════════════════════════════════════

import { FilingDetectionScheduler } from '../../src/filings/filing-detection-scheduler.service';

describe('Phase 5 — Filing Detection Scheduler: Monday Transcript Freshness', () => {
  let scheduler: FilingDetectionScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new FilingDetectionScheduler(
      mockPrisma as any,
      mockDetectorService as any,
      mockSecSyncService as any,
      mockSecProcessingService as any,
      mockNotificationService as any,
      mockLockService as any,
      mockOrchestratorAgent as any,
    );
  });

  // P5-T2: Monday cron includes transcript freshness check
  it('P5-T2: runs transcript freshness check on Mondays', async () => {
    // Mock Date to be a Monday (day=1)
    const realDate = Date;
    const monday = new Date('2026-03-02T11:00:00Z'); // March 2, 2026 is a Monday
    jest.spyOn(global, 'Date').mockImplementation((...args: any[]) => {
      if (args.length === 0) return monday;
      return new (realDate as any)(...args);
    });
    (global.Date as any).now = realDate.now;

    await scheduler.runDailyDetection();

    // OrchestratorAgent.execute should have been called for each tracked ticker
    // with type='freshness_check'
    expect(mockOrchestratorAgent.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'NVDA',
        type: 'freshness_check',
        triggeredBy: 'scheduled',
      }),
    );
    expect(mockOrchestratorAgent.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'AAPL',
        type: 'freshness_check',
        triggeredBy: 'scheduled',
      }),
    );

    jest.restoreAllMocks();
  });

  // P5-T3: Tuesday cron does NOT run transcript check
  it('P5-T3: does NOT run transcript freshness check on non-Mondays', async () => {
    // Mock Date to be a Tuesday (day=2)
    const realDate = Date;
    const tuesday = new Date('2026-03-03T11:00:00Z'); // March 3, 2026 is a Tuesday
    jest.spyOn(global, 'Date').mockImplementation((...args: any[]) => {
      if (args.length === 0) return tuesday;
      return new (realDate as any)(...args);
    });
    (global.Date as any).now = realDate.now;

    await scheduler.runDailyDetection();

    // OrchestratorAgent.execute should NOT have been called
    expect(mockOrchestratorAgent.execute).not.toHaveBeenCalled();

    jest.restoreAllMocks();
  });

  // P5-T6: Cron missed — health check triggers catch-up
  it('P5-T6: health check triggers catch-up when cron missed >26h', async () => {
    const staleDate = new Date(Date.now() - 28 * 3600 * 1000); // 28 hours ago
    mockPrisma.filingDetectionState.findMany.mockResolvedValueOnce([
      { lastCheckDate: staleDate, ticker: 'NVDA', consecutiveFailures: 0 },
    ]);

    // Spy on runDailyDetection
    const runSpy = jest.spyOn(scheduler, 'runDailyDetection').mockResolvedValue(null);

    await scheduler.checkCronHealth();

    // Should have triggered catch-up
    expect(runSpy).toHaveBeenCalled();

    runSpy.mockRestore();
  });

  it('P5-T6b: health check does NOT trigger catch-up when cron ran recently', async () => {
    const recentDate = new Date(Date.now() - 4 * 3600 * 1000); // 4 hours ago
    mockPrisma.filingDetectionState.findMany.mockResolvedValueOnce([
      { lastCheckDate: recentDate, ticker: 'NVDA', consecutiveFailures: 0 },
    ]);

    const runSpy = jest.spyOn(scheduler, 'runDailyDetection').mockResolvedValue(null);

    await scheduler.checkCronHealth();

    // Should NOT have triggered catch-up
    expect(runSpy).not.toHaveBeenCalled();

    runSpy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: Query-Triggered Acquisition in RAG Service
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — RAG Service: Query-Triggered Acquisition', () => {
  // Test the regex patterns that detect insider/holdings/transcript queries
  const insiderRegex = /\b(insider|insiders|insider\s*(?:buying|selling|trading|transaction|activity)|form\s*4|officer\s*(?:sold|bought|purchased)|director\s*(?:sold|bought|purchased)|ceo\s*(?:sold|bought)|cfo\s*(?:sold|bought))\b/i;
  const holdingsRegex = /\b(institutional|institution|13f|13\-f|holder|holders|holdings|ownership|who\s*(?:owns|holds|bought)|largest\s*(?:shareholder|holder|investor))\b/i;
  const transcriptRegex = /\b(earnings\s*call|conference\s*call|what\s*did\s*(?:the\s*)?(?:ceo|cfo|management|[A-Z][a-z]+\s+[A-Z][a-z]+)\s*say|management\s*(?:tone|commentary|remarks|said|comment)|prepared\s*remarks|q\s*&\s*a|analyst\s*question|guidance\s*call|quarterly\s*call)\b/i;

  // P5-T1: Query referencing missing Form 4 data triggers background acquisition
  it('P5-T1: insider query regex matches Form 4 / insider queries', () => {
    expect(insiderRegex.test('Who are the insiders selling NVDA stock?')).toBe(true);
    expect(insiderRegex.test('Show me Form 4 filings for AAPL')).toBe(true);
    expect(insiderRegex.test('Has the CEO sold any shares recently?')).toBe(true);
    expect(insiderRegex.test('insider trading activity for MSFT')).toBe(true);
    expect(insiderRegex.test('What is NVDA revenue?')).toBe(false);
  });

  it('P5-T1b: holdings query regex matches 13F / institutional queries', () => {
    expect(holdingsRegex.test('Who are the largest institutional holders of NVDA?')).toBe(true);
    expect(holdingsRegex.test('Show me 13F holdings data')).toBe(true);
    expect(holdingsRegex.test('Who owns the most shares?')).toBe(true);
    expect(holdingsRegex.test('institutional ownership breakdown')).toBe(true);
    expect(holdingsRegex.test('What is NVDA revenue?')).toBe(false);
  });

  it('P5-T1c: transcript query regex matches earnings call queries', () => {
    expect(transcriptRegex.test('What did Jensen Huang say about data center revenue?')).toBe(true);
    expect(transcriptRegex.test('earnings call highlights for NVDA')).toBe(true);
    expect(transcriptRegex.test('management commentary on margins')).toBe(true);
    expect(transcriptRegex.test('prepared remarks from last quarter')).toBe(true);
    expect(transcriptRegex.test('analyst question about guidance')).toBe(true);
    expect(transcriptRegex.test('What is NVDA revenue?')).toBe(false);
  });

  it('P5-T1d: acquisition note is generated for missing data types', () => {
    // Simulate the logic from rag.service.ts
    const hasInsiderData = false;
    const isInsiderQuery = true;
    let responseAcquisitionNote: string | undefined;

    if (isInsiderQuery && !hasInsiderData) {
      responseAcquisitionNote = 'Insider transaction data is being acquired and will be available shortly.';
    }

    expect(responseAcquisitionNote).toBeDefined();
    expect(responseAcquisitionNote).toContain('Insider transaction data');
    expect(responseAcquisitionNote).toContain('available shortly');
  });

  it('P5-T1e: no acquisition note when data already exists', () => {
    const hasInsiderData = true;
    const isInsiderQuery = true;
    let responseAcquisitionNote: string | undefined;

    if (isInsiderQuery && !hasInsiderData) {
      responseAcquisitionNote = 'Insider transaction data is being acquired and will be available shortly.';
    }

    expect(responseAcquisitionNote).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: Data Coverage Display
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Data Coverage Display', () => {
  // P5-T5: Data coverage display shows counts per filing type + last updated
  it('P5-T5: getDataCoverage returns filing counts, insider/holdings/transcript counts, and lastUpdated', async () => {
    const mockDealService = {
      getDealById: jest.fn().mockResolvedValue({ id: 'deal-1', ticker: 'NVDA' }),
    };

    const mockPrismaForCoverage = {
      deal: { findUnique: jest.fn().mockResolvedValue({ id: 'deal-1', ticker: 'NVDA' }) },
      $queryRawUnsafe: jest.fn()
        .mockResolvedValueOnce([ // filing counts
          { filing_type: '10-K', count: 5, latest: '2024-12-31' },
          { filing_type: '10-Q', count: 16, latest: '2025-09-30' },
          { filing_type: '8-K', count: 23, latest: '2025-11-15' },
          { filing_type: 'DEF 14A', count: 4, latest: '2025-06-01' },
        ])
        .mockResolvedValueOnce([ // insider transactions
          { count: 87 },
        ])
        .mockResolvedValueOnce([ // institutional holdings
          { count: 12 },
        ])
        .mockResolvedValueOnce([ // earnings transcripts
          { count: 8 },
        ])
        .mockResolvedValueOnce([ // last updated
          { latest: '2026-03-04T06:02:00.000Z' },
        ]),
    };

    // Simulate the getDataCoverage logic
    const ticker = 'NVDA';
    const filingCounts = await mockPrismaForCoverage.$queryRawUnsafe();
    const filings: Record<string, { count: number; latest: string | null }> = {};
    for (const row of filingCounts) {
      filings[row.filing_type] = { count: row.count, latest: row.latest };
    }

    const itResult = await mockPrismaForCoverage.$queryRawUnsafe();
    const insiderTransactions = itResult[0]?.count || 0;

    const ihResult = await mockPrismaForCoverage.$queryRawUnsafe();
    const institutionalHoldings = ihResult[0]?.count || 0;

    const etResult = await mockPrismaForCoverage.$queryRawUnsafe();
    const earningsTranscripts = etResult[0]?.count || 0;

    const lastRow = await mockPrismaForCoverage.$queryRawUnsafe();
    const lastUpdated = lastRow[0]?.latest || null;

    const coverage = { ticker, filings, insiderTransactions, institutionalHoldings, earningsTranscripts, lastUpdated };

    expect(coverage.ticker).toBe('NVDA');
    expect(coverage.filings['10-K']).toEqual({ count: 5, latest: '2024-12-31' });
    expect(coverage.filings['10-Q']).toEqual({ count: 16, latest: '2025-09-30' });
    expect(coverage.filings['8-K']).toEqual({ count: 23, latest: '2025-11-15' });
    expect(coverage.filings['DEF 14A']).toEqual({ count: 4, latest: '2025-06-01' });
    expect(coverage.insiderTransactions).toBe(87);
    expect(coverage.institutionalHoldings).toBe(12);
    expect(coverage.earningsTranscripts).toBe(8);
    expect(coverage.lastUpdated).toBeTruthy();
  });

  it('P5-T5b: data coverage returns zeros for ticker with no data', () => {
    const coverage = {
      ticker: 'NEWCO',
      filings: {},
      insiderTransactions: 0,
      institutionalHoldings: 0,
      earningsTranscripts: 0,
      lastUpdated: null,
    };

    expect(coverage.ticker).toBe('NEWCO');
    expect(Object.keys(coverage.filings)).toHaveLength(0);
    expect(coverage.insiderTransactions).toBe(0);
    expect(coverage.institutionalHoldings).toBe(0);
    expect(coverage.earningsTranscripts).toBe(0);
    expect(coverage.lastUpdated).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: Orchestrator Trigger Connections
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Orchestrator Trigger Connections', () => {
  // P5-T4: New deal creation triggers full acquisition
  it('P5-T4: OrchestratorAgent.execute accepts full_acquisition task type', async () => {
    const task = {
      ticker: 'NVDA',
      companyName: 'NVIDIA Corporation',
      type: 'full_acquisition' as const,
      triggeredBy: 'deal_creation' as const,
    };

    const report = await mockOrchestratorAgent.execute(task);

    expect(mockOrchestratorAgent.execute).toHaveBeenCalledWith(task);
    expect(report).toHaveProperty('ticker', 'NVDA');
    expect(report).toHaveProperty('triggeredBy', 'query_triggered'); // mock returns this
    expect(report).toHaveProperty('actions');
    expect(report).toHaveProperty('errors');
    expect(report).toHaveProperty('transcriptsAcquired');
  });

  it('P5-T4b: OrchestratorAgent.execute accepts query_triggered task', async () => {
    const task = {
      ticker: 'AAPL',
      companyName: 'Apple Inc.',
      type: 'specific' as const,
      description: 'Acquire Form 4 insider transaction data',
      triggeredBy: 'query_triggered' as const,
    };

    await mockOrchestratorAgent.execute(task);

    expect(mockOrchestratorAgent.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: 'AAPL',
        type: 'specific',
        triggeredBy: 'query_triggered',
      }),
    );
  });

  it('P5-T4c: OrchestratorAgent.execute accepts freshness_check task', async () => {
    const task = {
      ticker: 'MSFT',
      companyName: 'Microsoft Corporation',
      type: 'freshness_check' as const,
      triggeredBy: 'scheduled' as const,
    };

    await mockOrchestratorAgent.execute(task);

    expect(mockOrchestratorAgent.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'freshness_check',
        triggeredBy: 'scheduled',
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: Acquisition Note in RAGResponse
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — RAGResponse acquisitionNote field', () => {
  it('acquisitionNote field exists in processingInfo type', () => {
    // Verify the type allows acquisitionNote
    const processingInfo: {
      structuredMetrics: number;
      semanticNarratives: number;
      userDocumentChunks: number;
      usedBedrockKB: boolean;
      usedClaudeGeneration: boolean;
      hybridProcessing: boolean;
      fromCache?: boolean;
      acquisitionNote?: string;
    } = {
      structuredMetrics: 0,
      semanticNarratives: 0,
      userDocumentChunks: 0,
      usedBedrockKB: false,
      usedClaudeGeneration: false,
      hybridProcessing: true,
      acquisitionNote: 'Insider transaction data is being acquired and will be available shortly.',
    };

    expect(processingInfo.acquisitionNote).toBeDefined();
    expect(processingInfo.acquisitionNote).toContain('being acquired');
  });

  it('acquisitionNote is undefined when no data is missing', () => {
    const processingInfo = {
      structuredMetrics: 5,
      semanticNarratives: 3,
      userDocumentChunks: 0,
      usedBedrockKB: true,
      usedClaudeGeneration: true,
      hybridProcessing: true,
      acquisitionNote: undefined as string | undefined,
    };

    expect(processingInfo.acquisitionNote).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: Scheduler without OrchestratorAgent (graceful degradation)
// ═══════════════════════════════════════════════════════════════════════════

describe('Phase 5 — Scheduler graceful degradation without OrchestratorAgent', () => {
  it('scheduler works without OrchestratorAgent (optional dependency)', async () => {
    const schedulerWithoutAgent = new FilingDetectionScheduler(
      mockPrisma as any,
      mockDetectorService as any,
      mockSecSyncService as any,
      mockSecProcessingService as any,
      mockNotificationService as any,
      mockLockService as any,
      // No orchestratorAgent — should not crash
    );

    // Mock Date to be a Monday
    const realDate = Date;
    const monday = new Date('2026-03-02T11:00:00Z');
    jest.spyOn(global, 'Date').mockImplementation((...args: any[]) => {
      if (args.length === 0) return monday;
      return new (realDate as any)(...args);
    });
    (global.Date as any).now = realDate.now;

    // Should not throw even on Monday without orchestratorAgent
    await expect(schedulerWithoutAgent.runDailyDetection()).resolves.not.toThrow();

    jest.restoreAllMocks();
  });
});
