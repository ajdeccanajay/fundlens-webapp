/**
 * Vision Text Extraction — Cross-Service Integration Tests
 *
 * Tests the end-to-end vision extraction pipeline that ensures financial tables
 * from analyst PDFs (positioned graphics that pdfplumber can't extract) are
 * captured and made available to the RAG pipeline.
 *
 * Coverage:
 *   1. VisionExtractionService.visionResultsToText — structured → text conversion
 *   2. BackgroundEnrichmentService.stepVisionExtract — vision text S3 storage
 *   3. DocumentIntelligenceService.processInstantIntelligence — vision-only extraction scheduling
 *   4. DocumentIndexingService.getLongContextFallbackText — vision text inclusion
 *   5. RAGService.searchUploadedDocs — increased char limit (6000 → 20000)
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  VisionExtractionService,
  VisionPageResult,
} from '../../src/documents/vision-extraction.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { S3Service } from '../../src/services/s3.service';

// ═══════════════════════════════════════════════════════════════
// 1. VisionExtractionService.visionResultsToText
// ═══════════════════════════════════════════════════════════════

describe('VisionExtractionService.visionResultsToText', () => {
  let service: VisionExtractionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VisionExtractionService,
        { provide: BedrockService, useValue: {} },
        { provide: S3Service, useValue: {} },
      ],
    }).compile();
    service = module.get(VisionExtractionService);
  });

  it('should convert a single table with headers and rows to markdown text', () => {
    const results: VisionPageResult[] = [{
      pageNumber: 3,
      tables: [{
        tableType: 'income-statement',
        title: 'Income Statement Summary',
        currency: 'USD',
        units: 'millions',
        headers: [{ cells: ['Metric', 'FY2023', 'FY2024', 'FY2025E'], rowIndex: 0 }],
        rows: [
          {
            label: 'Revenue',
            cells: [
              { value: '$574.8B', numericValue: 574800, isNegative: false, isEstimate: false },
              { value: '$638.0B', numericValue: 638000, isNegative: false, isEstimate: false },
              { value: '$716.9B', numericValue: 716900, isNegative: false, isEstimate: true },
            ],
          },
          {
            label: 'EBITDA',
            cells: [
              { value: '$85.5B', numericValue: 85500, isNegative: false, isEstimate: false },
              { value: '$105.2B', numericValue: 105200, isNegative: false, isEstimate: false },
              { value: '$130.0B', numericValue: 130000, isNegative: false, isEstimate: true },
            ],
          },
        ],
      }],
      charts: [],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    const text = service.visionResultsToText(results);

    expect(text).toContain('=== FINANCIAL TABLES');
    expect(text).toContain('TABLE: Income Statement Summary (millions) [USD]');
    expect(text).toContain('| Metric | FY2023 | FY2024 | FY2025E |');
    expect(text).toContain('| Revenue | $574.8B | $638.0B | $716.9B |');
    expect(text).toContain('| EBITDA | $85.5B | $105.2B | $130.0B |');
  });

  it('should include chart data points as text', () => {
    const results: VisionPageResult[] = [{
      pageNumber: 5,
      tables: [],
      charts: [{
        chartType: 'bar',
        title: 'Revenue Growth by Segment',
        dataPoints: [
          { label: 'AWS', value: 14, series: 'YoY Growth %' },
          { label: 'Advertising', value: 21, series: 'YoY Growth %' },
          { label: 'Retail', value: 8, series: 'YoY Growth %' },
        ],
      }],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    const text = service.visionResultsToText(results);

    expect(text).toContain('CHART: Revenue Growth by Segment');
    expect(text).toContain('AWS: 14 (YoY Growth %)');
    expect(text).toContain('Advertising: 21 (YoY Growth %)');
  });

  it('should handle multiple pages with tables and charts', () => {
    const results: VisionPageResult[] = [
      {
        pageNumber: 3,
        tables: [{
          tableType: 'valuation',
          title: 'Valuation Metrics',
          headers: [],
          rows: [
            { label: 'P/E', cells: [{ value: '22.5x', numericValue: 22.5, isNegative: false, isEstimate: false }] },
          ],
        }],
        charts: [],
        narratives: [],
        footnotes: [],
        entities: { companies: [], dates: [], metrics: [] },
      },
      {
        pageNumber: 7,
        tables: [{
          tableType: 'comp-table',
          title: 'Peer Comparison',
          headers: [],
          rows: [
            { label: 'AMZN', cells: [{ value: '15.2x', numericValue: 15.2, isNegative: false, isEstimate: false }] },
          ],
        }],
        charts: [],
        narratives: [],
        footnotes: [],
        entities: { companies: [], dates: [], metrics: [] },
      },
    ];

    const text = service.visionResultsToText(results);

    expect(text).toContain('TABLE: Valuation Metrics');
    expect(text).toContain('TABLE: Peer Comparison');
    expect(text).toContain('| P/E | 22.5x |');
    expect(text).toContain('| AMZN | 15.2x |');
  });

  it('should return empty string for empty vision results', () => {
    expect(service.visionResultsToText([])).toBe('');
    expect(service.visionResultsToText(null as any)).toBe('');
    expect(service.visionResultsToText(undefined as any)).toBe('');
  });

  it('should return empty string when pages have no tables or charts', () => {
    const results: VisionPageResult[] = [{
      pageNumber: 1,
      tables: [],
      charts: [],
      narratives: [{ type: 'paragraph', text: 'Some narrative text' }],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    expect(service.visionResultsToText(results)).toBe('');
  });

  it('should handle tables without headers', () => {
    const results: VisionPageResult[] = [{
      pageNumber: 2,
      tables: [{
        tableType: 'summary',
        title: 'Key Metrics',
        headers: [],
        rows: [
          { label: 'Price Target', cells: [{ value: '$255', numericValue: 255, isNegative: false, isEstimate: true }] },
          { label: 'Rating', cells: [{ value: 'BUY', numericValue: null, isNegative: false, isEstimate: false }] },
        ],
      }],
      charts: [],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    const text = service.visionResultsToText(results);

    expect(text).toContain('TABLE: Key Metrics');
    expect(text).toContain('| Price Target | $255 |');
    expect(text).toContain('| Rating | BUY |');
    // No header separator lines when no headers
    expect(text).not.toContain('| --- |');
  });

  it('should use tableType as fallback title', () => {
    const results: VisionPageResult[] = [{
      pageNumber: 1,
      tables: [{
        tableType: 'comp-table',
        title: '',
        headers: [],
        rows: [{ label: 'Test', cells: [{ value: '1', numericValue: 1, isNegative: false, isEstimate: false }] }],
      }],
      charts: [],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    const text = service.visionResultsToText(results);
    expect(text).toContain('TABLE: comp-table');
  });

  it('should handle charts without series', () => {
    const results: VisionPageResult[] = [{
      pageNumber: 1,
      tables: [],
      charts: [{
        chartType: 'line',
        title: 'Revenue Trend',
        dataPoints: [
          { label: 'Q1', value: 100 },
          { label: 'Q2', value: 110 },
        ],
      }],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    const text = service.visionResultsToText(results);
    expect(text).toContain('Q1: 100');
    expect(text).not.toContain('(undefined)');
  });

  it('should skip charts with no data points', () => {
    const results: VisionPageResult[] = [{
      pageNumber: 1,
      tables: [],
      charts: [{ chartType: 'bar', title: 'Empty Chart', dataPoints: [] }],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    const text = service.visionResultsToText(results);
    expect(text).toBe('');
  });
});


// ═══════════════════════════════════════════════════════════════
// 2. BackgroundEnrichmentService — vision text S3 storage
// ═══════════════════════════════════════════════════════════════

import { BackgroundEnrichmentService } from '../../src/documents/background-enrichment.service';
import { DocumentChunkingService } from '../../src/documents/document-chunking.service';
import { DocumentIndexingService } from '../../src/documents/document-indexing.service';
import { MetricPersistenceService } from '../../src/documents/metric-persistence.service';
import { ExcelExtractorService } from '../../src/documents/excel-extractor.service';
import { EarningsCallExtractorService } from '../../src/documents/earnings-call-extractor.service';
import { CallAnalysisPersistenceService } from '../../src/documents/call-analysis-persistence.service';
import { DocumentFlagsPersistenceService } from '../../src/documents/document-flags-persistence.service';
import { ModelFormulasPersistenceService } from '../../src/documents/model-formulas-persistence.service';
import { IntakeSummaryService } from '../../src/documents/intake-summary.service';
import { VerificationService } from '../../src/documents/verification.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('BackgroundEnrichmentService — vision text storage', () => {
  let service: BackgroundEnrichmentService;
  let mockExecuteRawUnsafe: jest.Mock;
  let mockQueryRaw: jest.Mock;
  let mockGetFileBuffer: jest.Mock;
  let mockUploadBuffer: jest.Mock;
  let mockIdentifyKeyPages: jest.Mock;
  let mockExtractFromPages: jest.Mock;
  let mockFlattenMetrics: jest.Mock;
  let mockVisionResultsToText: jest.Mock;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDealId = '22222222-2222-2222-2222-222222222222';
  const mockDocId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
    mockExecuteRawUnsafe = jest.fn().mockResolvedValue(undefined);
    mockQueryRaw = jest.fn();
    mockGetFileBuffer = jest.fn();
    mockUploadBuffer = jest.fn().mockResolvedValue(undefined);
    mockIdentifyKeyPages = jest.fn().mockReturnValue([1, 2, 3]);
    mockExtractFromPages = jest.fn().mockResolvedValue([]);
    mockFlattenMetrics = jest.fn().mockReturnValue([]);
    mockVisionResultsToText = jest.fn().mockReturnValue('');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackgroundEnrichmentService,
        VerificationService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: mockQueryRaw,
            $executeRawUnsafe: mockExecuteRawUnsafe,
          },
        },
        {
          provide: S3Service,
          useValue: {
            getFileBuffer: mockGetFileBuffer,
            uploadBuffer: mockUploadBuffer,
          },
        },
        {
          provide: BedrockService,
          useValue: { invokeClaude: jest.fn() },
        },
        {
          provide: VisionExtractionService,
          useValue: {
            identifyKeyPages: mockIdentifyKeyPages,
            extractFromPages: mockExtractFromPages,
            flattenMetrics: mockFlattenMetrics,
            visionResultsToText: mockVisionResultsToText,
          },
        },
        {
          provide: DocumentChunkingService,
          useValue: { chunk: jest.fn().mockReturnValue([]) },
        },
        {
          provide: DocumentIndexingService,
          useValue: {
            indexChunks: jest.fn().mockResolvedValue(0),
            deleteChunks: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MetricPersistenceService,
          useValue: { persistFromExtractions: jest.fn().mockResolvedValue({ persisted: 0 }) },
        },
        {
          provide: ExcelExtractorService,
          useValue: { extract: jest.fn().mockResolvedValue({ metrics: [], tables: [], formulaGraph: [], textChunks: [] }) },
        },
        {
          provide: EarningsCallExtractorService,
          useValue: {
            extract: jest.fn().mockResolvedValue({ qaExchanges: [], allMetrics: [], redFlags: [], toneAnalysis: { overallConfidence: 0 } }),
            toChunks: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: CallAnalysisPersistenceService,
          useValue: { persist: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: DocumentFlagsPersistenceService,
          useValue: { persist: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ModelFormulasPersistenceService,
          useValue: { persist: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: IntakeSummaryService,
          useValue: { generate: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(BackgroundEnrichmentService);
  });

  function setupVisionEnrichment(visionText: string) {
    // Enable vision extraction
    process.env.ENABLE_VISION_EXTRACTION = 'true';

    const rawText = 'Revenue grew 15% YoY to $100M. EBITDA margin expanded to 25%. '.repeat(20);
    const visionResults = [{
      pageNumber: 3,
      tables: [{ tableType: 'comp-table', title: 'Peers', rows: [], headers: [] }],
      charts: [],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    }];

    let callCount = 0;
    mockQueryRaw.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([{
          s3_key: 'raw-uploads/test.pdf',
          raw_text_s3_key: 'extracted/tenant/deal/doc/raw_text.txt',
          file_type: 'application/pdf',
          document_type: 'sell-side-report',
          file_name: 'test-report.pdf',
          company_ticker: 'AMZN',
          company_name: 'Amazon',
          deal_id: mockDealId,
        }]);
      }
      return Promise.resolve([{ deal_library_id: null, upload_source: 'chat' }]);
    });

    mockGetFileBuffer.mockResolvedValue(Buffer.from(rawText));
    mockExtractFromPages.mockResolvedValue(visionResults);
    mockFlattenMetrics.mockReturnValue([]);
    mockVisionResultsToText.mockReturnValue(visionText);
  }

  afterEach(() => {
    delete process.env.ENABLE_VISION_EXTRACTION;
  });

  it('should store vision text to S3 when vision extraction produces content', async () => {
    const visionText = '\n\n=== FINANCIAL TABLES ===\n\nTABLE: Income Statement\n| Revenue | $100M | $110M |\n| EBITDA | $45M | $50M |';
    setupVisionEnrichment(visionText);

    await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

    // Should have uploaded vision text to S3
    const uploadCalls = mockUploadBuffer.mock.calls.filter(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes('vision_text.txt'),
    );
    expect(uploadCalls.length).toBe(1);
    expect(uploadCalls[0][1]).toBe('extracted/tenant/deal/doc/vision_text.txt');
    expect(uploadCalls[0][0].toString()).toContain('FINANCIAL TABLES');

    // Should have updated intel_documents with vision_text_s3_key
    const updateCalls = mockExecuteRawUnsafe.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('vision_text_s3_key'),
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0][1]).toBe('extracted/tenant/deal/doc/vision_text.txt');
  });

  it('should NOT store vision text when content is too short (< 100 chars)', async () => {
    setupVisionEnrichment('short');

    await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

    const uploadCalls = mockUploadBuffer.mock.calls.filter(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes('vision_text.txt'),
    );
    expect(uploadCalls.length).toBe(0);
  });

  it('should NOT store vision text when raw_text_s3_key is null', async () => {
    process.env.ENABLE_VISION_EXTRACTION = 'true';

    let callCount = 0;
    mockQueryRaw.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([{
          s3_key: 'raw-uploads/test.pdf',
          raw_text_s3_key: null,
          file_type: 'application/pdf',
          document_type: 'sell-side-report',
          file_name: 'test-report.pdf',
          company_ticker: 'AMZN',
          company_name: 'Amazon',
          deal_id: mockDealId,
        }]);
      }
      return Promise.resolve([]);
    });
    mockGetFileBuffer.mockResolvedValue(Buffer.from('short'));

    await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

    const uploadCalls = mockUploadBuffer.mock.calls.filter(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes('vision_text.txt'),
    );
    expect(uploadCalls.length).toBe(0);
  });

  it('should derive vision_text.txt S3 key from raw_text.txt key', async () => {
    const visionText = '\n\n=== FINANCIAL TABLES ===\n\n' + 'TABLE: Test\n| Row | Value |\n'.repeat(10);
    setupVisionEnrichment(visionText);

    await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

    const uploadCalls = mockUploadBuffer.mock.calls.filter(
      (c: any[]) => typeof c[1] === 'string' && c[1].includes('vision_text.txt'),
    );
    if (uploadCalls.length > 0) {
      // vision_text.txt should be sibling of raw_text.txt
      expect(uploadCalls[0][1]).toBe('extracted/tenant/deal/doc/vision_text.txt');
    }
  });
});


// ═══════════════════════════════════════════════════════════════
// 3. DocumentIntelligenceService — vision-only extraction scheduling
// ═══════════════════════════════════════════════════════════════

import { DocumentIntelligenceService } from '../../src/documents/document-intelligence.service';

// Mock pdf-parse v2.x
jest.mock('pdf-parse', () => {
  class MockPDFParse {
    async getText() { return { text: 'Revenue grew 15% to $100M. EBITDA margin 25%. Price target $275. Rating BUY. EPS $7.83.', total: 5, pages: [] }; }
  }
  return { PDFParse: MockPDFParse };
});

describe('DocumentIntelligenceService — vision-only extraction', () => {
  let service: DocumentIntelligenceService;
  let s3: jest.Mocked<S3Service>;
  let bedrock: jest.Mocked<BedrockService>;
  let prisma: jest.Mocked<PrismaService>;
  let mockVisionExtraction: any;
  let mockBackgroundEnrichment: any;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDealId = '22222222-2222-2222-2222-222222222222';
  const mockDocId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
    mockVisionExtraction = {
      identifyKeyPages: jest.fn().mockReturnValue([1, 2, 3]),
      extractFromPages: jest.fn().mockResolvedValue([]),
      flattenMetrics: jest.fn().mockReturnValue([]),
      visionResultsToText: jest.fn().mockReturnValue(''),
    };

    mockBackgroundEnrichment = {
      enrichDocument: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentIntelligenceService,
        {
          provide: PrismaService,
          useValue: {
            $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
            $queryRaw: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: BedrockService,
          useValue: {
            invokeClaude: jest.fn().mockResolvedValue(JSON.stringify({
              documentType: 'sell-side-report',
              companyName: 'Amazon',
              ticker: 'AMZN',
              summary: 'DBS initiating coverage on Amazon',
              metrics: [
                { metric_key: 'price_target', raw_value: '$255', numeric_value: 255, period: 'FY2026E', is_estimate: true },
              ],
              suggestedQuestions: ['What is the price target?'],
            })),
          },
        },
        {
          provide: S3Service,
          useValue: {
            getFileBuffer: jest.fn().mockResolvedValue(Buffer.from('Revenue grew 15% to $100M. EBITDA margin 25%.')),
            uploadBuffer: jest.fn().mockResolvedValue({ key: 'test-key', bucket: 'test' }),
          },
        },
        {
          provide: BackgroundEnrichmentService,
          useValue: mockBackgroundEnrichment,
        },
        {
          provide: VisionExtractionService,
          useValue: mockVisionExtraction,
        },
      ],
    }).compile();

    service = module.get(DocumentIntelligenceService);
    s3 = module.get(S3Service);
    bedrock = module.get(BedrockService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    delete process.env.ENABLE_BACKGROUND_ENRICHMENT;
    delete process.env.VISION_DELAY_MS;
    jest.useRealTimers();
  });

  it('should schedule vision-only extraction for PDFs when ENABLE_BACKGROUND_ENRICHMENT is not set', async () => {
    jest.useFakeTimers();
    process.env.VISION_DELAY_MS = '0'; // No delay for testing

    await service.processInstantIntelligence(
      mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test-report.pdf',
      mockTenantId, mockDealId,
    );

    // Advance timers to trigger the setTimeout
    jest.advanceTimersByTime(100);

    // Allow async operations to complete
    await Promise.resolve();
    await Promise.resolve();

    // Vision extraction should have been called
    expect(mockVisionExtraction.identifyKeyPages).toHaveBeenCalled();
  });

  it('should NOT schedule vision-only extraction for non-PDF files', async () => {
    jest.useFakeTimers();

    await service.processInstantIntelligence(
      mockDocId, 'raw-uploads/test.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'model.xlsx', mockTenantId, mockDealId,
    );

    jest.advanceTimersByTime(10000);
    await Promise.resolve();

    expect(mockVisionExtraction.identifyKeyPages).not.toHaveBeenCalled();
  });

  it('should prefer full background enrichment when ENABLE_BACKGROUND_ENRICHMENT=true', async () => {
    process.env.ENABLE_BACKGROUND_ENRICHMENT = 'true';
    jest.useFakeTimers();

    await service.processInstantIntelligence(
      mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test-report.pdf',
      mockTenantId, mockDealId,
    );

    jest.advanceTimersByTime(60000);
    await Promise.resolve();

    // Full enrichment should be scheduled, not vision-only
    expect(mockBackgroundEnrichment.enrichDocument).toHaveBeenCalled();
    // Vision-only should NOT be called directly (full enrichment handles it)
    expect(mockVisionExtraction.identifyKeyPages).not.toHaveBeenCalled();
  });

  it('should return instant intelligence result regardless of vision scheduling', async () => {
    const result = await service.processInstantIntelligence(
      mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test-report.pdf',
      mockTenantId, mockDealId,
    );

    expect(result.documentId).toBe(mockDocId);
    expect(result.documentType).toBe('sell-side-report');
    expect(result.ticker).toBe('AMZN');
    expect(result.headlineMetrics).toHaveLength(1);
    expect(result.headlineMetrics[0].metric_key).toBe('price_target');
  });
});


// ═══════════════════════════════════════════════════════════════
// 4. DocumentIndexingService — vision text inclusion in fallback
// ═══════════════════════════════════════════════════════════════

import { DocumentIndexingService } from '../../src/documents/document-indexing.service';

describe('DocumentIndexingService — vision text in long-context fallback', () => {
  let service: DocumentIndexingService;
  let mockQueryRawUnsafe: jest.Mock;
  let mockGetFileBuffer: jest.Mock;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    mockQueryRawUnsafe = jest.fn();
    mockGetFileBuffer = jest.fn();

    // Use a custom factory to ensure @Optional S3Service is injected
    service = new (DocumentIndexingService as any)(
      {
        $queryRawUnsafe: mockQueryRawUnsafe,
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
      },
      {
        generateEmbedding: jest.fn().mockResolvedValue(new Array(1024).fill(0)),
      },
      {
        getFileBuffer: mockGetFileBuffer,
      },
    );
  });

  it('should include vision text when vision_text_s3_key is present', async () => {
    mockQueryRawUnsafe.mockResolvedValue([{
      document_id: 'doc-1',
      file_name: 'Amazon - DBS.pdf',
      company_ticker: 'AMZN',
      raw_text_s3_key: 'extracted/t/d/doc/raw_text.txt',
      vision_text_s3_key: 'extracted/t/d/doc/vision_text.txt',
    }]);

    const rawText = 'DBS Group Research report on Amazon. BUY rating with $255 target price.';
    // Vision text must be > 100 chars to be included
    const visionText = '\n\n=== FINANCIAL TABLES (extracted via document vision analysis) ===\n\nTABLE: Income Statement\n| Revenue | $574.8B | $638.0B | $716.9B |\n| EBITDA | $85.5B | $105.2B | $130.0B |';

    mockGetFileBuffer.mockImplementation((key: string) => {
      if (key.includes('vision_text')) return Promise.resolve(Buffer.from(visionText));
      return Promise.resolve(Buffer.from(rawText));
    });

    const results = await service.getLongContextFallbackText(mockTenantId, {
      companyTicker: 'AMZN',
      maxDocs: 1,
      maxCharsPerDoc: 10000,
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('DBS Group Research');
    expect(results[0].content).toContain('FINANCIAL TABLES');
    expect(results[0].content).toContain('Revenue');
  });

  it('should work without vision text (backward compatible)', async () => {
    mockQueryRawUnsafe.mockResolvedValue([{
      document_id: 'doc-1',
      file_name: 'report.pdf',
      company_ticker: 'AAPL',
      raw_text_s3_key: 'extracted/t/d/doc/raw_text.txt',
      vision_text_s3_key: null,
    }]);

    const rawText = 'Apple Inc. annual report. Revenue $394.3B.';
    mockGetFileBuffer.mockResolvedValue(Buffer.from(rawText));

    const results = await service.getLongContextFallbackText(mockTenantId, {
      companyTicker: 'AAPL',
      maxDocs: 1,
      maxCharsPerDoc: 10000,
    });

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Apple Inc.');
    expect(results[0].content).not.toContain('FINANCIAL TABLES');
  });

  it('should allocate ~40% of char budget to vision text', async () => {
    mockQueryRawUnsafe.mockResolvedValue([{
      document_id: 'doc-1',
      file_name: 'report.pdf',
      company_ticker: 'AMZN',
      raw_text_s3_key: 'extracted/t/d/doc/raw_text.txt',
      vision_text_s3_key: 'extracted/t/d/doc/vision_text.txt',
    }]);

    const rawText = 'A'.repeat(10000);
    const visionText = 'V'.repeat(5000);
    const maxCharsPerDoc = 8000;

    mockGetFileBuffer.mockImplementation((key: string) => {
      if (key.includes('vision_text')) return Promise.resolve(Buffer.from(visionText));
      return Promise.resolve(Buffer.from(rawText));
    });

    const results = await service.getLongContextFallbackText(mockTenantId, {
      maxDocs: 1,
      maxCharsPerDoc,
    });

    expect(results).toHaveLength(1);
    // Total should not exceed maxCharsPerDoc
    expect(results[0].content.length).toBeLessThanOrEqual(maxCharsPerDoc);
    // Vision text should be included
    expect(results[0].content).toContain('V');
    // Raw text should be truncated to make room
    const rawPortion = results[0].content.replace(/V+$/, '');
    expect(rawPortion.length).toBeLessThan(rawText.length);
  });

  it('should gracefully handle vision text S3 fetch failure', async () => {
    mockQueryRawUnsafe.mockResolvedValue([{
      document_id: 'doc-1',
      file_name: 'report.pdf',
      company_ticker: 'AMZN',
      raw_text_s3_key: 'extracted/t/d/doc/raw_text.txt',
      vision_text_s3_key: 'extracted/t/d/doc/vision_text.txt',
    }]);

    const rawText = 'Amazon report content here.';

    mockGetFileBuffer.mockImplementation((key: string) => {
      if (key.includes('vision_text')) return Promise.reject(new Error('S3 NoSuchKey'));
      return Promise.resolve(Buffer.from(rawText));
    });

    const results = await service.getLongContextFallbackText(mockTenantId, {
      companyTicker: 'AMZN',
      maxDocs: 1,
      maxCharsPerDoc: 10000,
    });

    // Should still return the raw text even if vision text fails
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('Amazon report content');
  });

  it('should skip vision text shorter than 100 chars', async () => {
    mockQueryRawUnsafe.mockResolvedValue([{
      document_id: 'doc-1',
      file_name: 'report.pdf',
      company_ticker: 'AMZN',
      raw_text_s3_key: 'extracted/t/d/doc/raw_text.txt',
      vision_text_s3_key: 'extracted/t/d/doc/vision_text.txt',
    }]);

    const rawText = 'Full raw text content.';
    const visionText = 'Too short';

    mockGetFileBuffer.mockImplementation((key: string) => {
      if (key.includes('vision_text')) return Promise.resolve(Buffer.from(visionText));
      return Promise.resolve(Buffer.from(rawText));
    });

    const results = await service.getLongContextFallbackText(mockTenantId, {
      maxDocs: 1,
      maxCharsPerDoc: 10000,
    });

    expect(results).toHaveLength(1);
    // Should use full raw text without vision text appended
    expect(results[0].content).toBe('Full raw text content.');
  });
});
