/**
 * BackgroundEnrichmentService — Unit Tests
 * Spec §3.4 Phase B: Background enrichment pipeline.
 *
 * Current pipeline (vision disabled for memory optimization):
 *   1. Fetch document record + raw text
 *   2. Chunk raw text (DocumentChunkingService)
 *   3. Embed + index chunks (DocumentIndexingService)
 *   4. Upgrade document to fully-indexed
 *   5. KB sync prep for deal library docs
 *
 * Vision extraction is disabled (pdf-to-img causes V8 OOM).
 * Will be re-enabled when running on ECS with more memory.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BackgroundEnrichmentService } from '../../src/documents/background-enrichment.service';
import { VisionExtractionService } from '../../src/documents/vision-extraction.service';
import { VerificationService } from '../../src/documents/verification.service';
import { DocumentChunkingService } from '../../src/documents/document-chunking.service';
import { DocumentIndexingService } from '../../src/documents/document-indexing.service';
import { MetricPersistenceService } from '../../src/documents/metric-persistence.service';
import { ExcelExtractorService } from '../../src/documents/excel-extractor.service';
import { EarningsCallExtractorService } from '../../src/documents/earnings-call-extractor.service';
import { CallAnalysisPersistenceService } from '../../src/documents/call-analysis-persistence.service';
import { DocumentFlagsPersistenceService } from '../../src/documents/document-flags-persistence.service';
import { ModelFormulasPersistenceService } from '../../src/documents/model-formulas-persistence.service';
import { IntakeSummaryService } from '../../src/documents/intake-summary.service';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../src/services/s3.service';

describe('BackgroundEnrichmentService', () => {
  let service: BackgroundEnrichmentService;
  let mockQueryRaw: jest.Mock;
  let mockExecuteRawUnsafe: jest.Mock;
  let mockGetFileBuffer: jest.Mock;
  let mockUploadBuffer: jest.Mock;
  let mockChunk: jest.Mock;
  let mockIndexChunks: jest.Mock;
  let mockDeleteChunks: jest.Mock;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDealId = '22222222-2222-2222-2222-222222222222';
  const mockDocId = '33333333-3333-3333-3333-333333333333';

  const mockChunks = [
    { chunkIndex: 0, content: 'Revenue grew 15% YoY to $100M driven by strong demand.', tokenEstimate: 50, sectionType: 'narrative' },
    { chunkIndex: 1, content: 'EBITDA margin expanded to 25% from 22% in the prior year.', tokenEstimate: 60, sectionType: 'narrative' },
  ];

  const defaultDocRecord = {
    s3_key: 'raw-uploads/test.pdf',
    raw_text_s3_key: 'extracted/tenant/deal/doc/raw_text.txt',
    file_type: 'application/pdf',
    document_type: 'sell-side-report',
    file_name: 'test-report.pdf',
  };

  const defaultDealLibraryCheck = { deal_library_id: null, upload_source: 'chat' };

  beforeEach(async () => {
    mockQueryRaw = jest.fn();
    mockExecuteRawUnsafe = jest.fn().mockResolvedValue(undefined);
    mockGetFileBuffer = jest.fn();
    mockUploadBuffer = jest.fn().mockResolvedValue(undefined);
    mockChunk = jest.fn().mockReturnValue(mockChunks);
    mockIndexChunks = jest.fn().mockResolvedValue(2);
    mockDeleteChunks = jest.fn().mockResolvedValue(undefined);

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
          provide: VisionExtractionService,
          useValue: {
            identifyKeyPages: jest.fn().mockReturnValue([]),
            extractFromPages: jest.fn().mockResolvedValue([]),
            flattenMetrics: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: DocumentChunkingService,
          useValue: { chunk: mockChunk },
        },
        {
          provide: DocumentIndexingService,
          useValue: {
            indexChunks: mockIndexChunks,
            deleteChunks: mockDeleteChunks,
          },
        },
        {
          provide: MetricPersistenceService,
          useValue: {
            persistFromExtractions: jest.fn().mockResolvedValue({ persisted: 0 }),
          },
        },
        {
          provide: ExcelExtractorService,
          useValue: {
            extract: jest.fn().mockResolvedValue({ metrics: [], tables: [], formulaGraph: [], textChunks: [] }),
          },
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
          useValue: {
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DocumentFlagsPersistenceService,
          useValue: {
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ModelFormulasPersistenceService,
          useValue: {
            persist: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: IntakeSummaryService,
          useValue: {
            generate: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(BackgroundEnrichmentService);
  });

  /** Helper: set up the standard mock sequence for a successful enrichment */
  function setupSuccessfulEnrichment(
    docRecord = defaultDocRecord,
    dealLibCheck = defaultDealLibraryCheck,
  ) {
    let callCount = 0;
    mockQueryRaw.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve([docRecord]);
      return Promise.resolve([dealLibCheck]);
    });
    mockGetFileBuffer.mockResolvedValue(
      Buffer.from('Revenue grew 15% YoY to $100M. EBITDA margin expanded to 25%. '.repeat(5)),
    );
  }

  describe('enrichDocument', () => {
    it('should chunk and index raw text (vision disabled)', async () => {
      setupSuccessfulEnrichment();

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(mockChunk).toHaveBeenCalledWith(
        expect.any(String),
        [], // empty vision results (disabled)
        expect.objectContaining({
          maxTokens: 600,
          overlap: 100,
          preserveTables: true,
          documentType: 'sell-side-report',
        }),
      );

      expect(mockIndexChunks).toHaveBeenCalledWith(
        mockDocId, mockTenantId, mockDealId, mockChunks,
      );

      // Should update document to fully-indexed with chunk_count
      const updateCalls = mockExecuteRawUnsafe.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('fully-indexed'),
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip enrichment for non-PDF files too (chunks raw text)', async () => {
      setupSuccessfulEnrichment({
        ...defaultDocRecord,
        s3_key: 'raw-uploads/test.xlsx',
        file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        document_type: 'spreadsheet',
        file_name: 'model.xlsx',
      });

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(mockChunk).toHaveBeenCalled();
      expect(mockIndexChunks).toHaveBeenCalled();
    });

    it('should handle document not found gracefully', async () => {
      mockQueryRaw.mockResolvedValue([]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(mockChunk).not.toHaveBeenCalled();
    });

    it('should skip enrichment when raw text is too short', async () => {
      setupSuccessfulEnrichment();
      mockGetFileBuffer.mockResolvedValue(Buffer.from('Hi'));

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(mockChunk).not.toHaveBeenCalled();
    });

    it('should handle indexing failure and record error', async () => {
      setupSuccessfulEnrichment();
      mockIndexChunks.mockRejectedValue(new Error('Bedrock timeout'));

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      const errorUpdates = mockExecuteRawUnsafe.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('error ='),
      );
      expect(errorUpdates.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip enrichment when no raw_text_s3_key', async () => {
      mockQueryRaw.mockResolvedValue([{
        ...defaultDocRecord,
        raw_text_s3_key: null,
      }]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(mockChunk).not.toHaveBeenCalled();
    });

    it('should prepare KB chunks for deal library documents', async () => {
      setupSuccessfulEnrichment(defaultDocRecord, {
        deal_library_id: 'some-id',
        upload_source: 'deal-library',
      });

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      // Should have written KB chunks to S3 (one per chunk)
      expect(mockUploadBuffer).toHaveBeenCalled();
      expect(mockUploadBuffer.mock.calls.length).toBe(mockChunks.length);

      // Should have updated kb_sync_status
      const kbUpdates = mockExecuteRawUnsafe.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('kb_sync_status'),
      );
      expect(kbUpdates.length).toBeGreaterThanOrEqual(1);
    });

    it('should set chunk_count on document after indexing', async () => {
      setupSuccessfulEnrichment();

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      // The fully-indexed update includes chunk_count
      const updateCalls = mockExecuteRawUnsafe.mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('chunk_count'),
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      // indexChunks returns 2
      expect(updateCalls[0]).toContain(2);
    });
  });
});
