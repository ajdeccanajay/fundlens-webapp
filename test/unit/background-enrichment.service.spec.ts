/**
 * BackgroundEnrichmentService — Unit Tests
 * Spec §3.4 Phase B: Background enrichment pipeline.
 *
 * Coverage:
 *   - enrichDocument: full pipeline orchestration
 *   - Non-PDF skip logic
 *   - Vision extraction → verification → persistence flow
 *   - Error handling (document still queryable via long-context)
 *   - Metric count update
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BackgroundEnrichmentService } from '../../src/documents/background-enrichment.service';
import { VisionExtractionService } from '../../src/documents/vision-extraction.service';
import { VerificationService } from '../../src/documents/verification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../src/services/s3.service';

describe('BackgroundEnrichmentService', () => {
  let service: BackgroundEnrichmentService;
  let prisma: jest.Mocked<PrismaService>;
  let s3: jest.Mocked<S3Service>;
  let visionExtraction: jest.Mocked<VisionExtractionService>;
  let verification: VerificationService; // Use real instance for verification logic

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDealId = '22222222-2222-2222-2222-222222222222';
  const mockDocId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackgroundEnrichmentService,
        VerificationService, // Real instance
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
            $executeRawUnsafe: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: S3Service,
          useValue: {
            getFileBuffer: jest.fn(),
          },
        },
        {
          provide: VisionExtractionService,
          useValue: {
            identifyKeyPages: jest.fn().mockReturnValue([1, 2, 5]),
            extractFromPages: jest.fn().mockResolvedValue([]),
            flattenMetrics: jest.fn().mockReturnValue([]),
          },
        },
      ],
    }).compile();

    service = module.get(BackgroundEnrichmentService);
    prisma = module.get(PrismaService);
    s3 = module.get(S3Service);
    visionExtraction = module.get(VisionExtractionService);
    verification = module.get(VerificationService);
  });

  // ─── enrichDocument ────────────────────────────────────────────

  describe('enrichDocument', () => {
    beforeEach(() => {
      // Default: PDF document with raw text
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{
        s3_key: 'raw-uploads/test.pdf',
        raw_text_s3_key: 'extracted/tenant/deal/doc/raw_text.txt',
        file_type: 'application/pdf',
        document_type: 'sell-side-report',
        file_name: 'test-report.pdf',
      }]);

      s3.getFileBuffer.mockResolvedValue(Buffer.from('Revenue $100M EBITDA $50M'));
    });

    it('should run the full enrichment pipeline for PDFs', async () => {
      visionExtraction.extractFromPages.mockResolvedValue([{
        pageNumber: 1,
        tables: [{
          tableType: 'comp-table',
          title: 'Peers',
          units: 'millions',
          headers: [{ cells: ['Company', 'Revenue'], rowIndex: 0 }],
          rows: [{
            label: 'AAPL',
            cells: [{ value: '$100M', numericValue: 100, isNegative: false, isEstimate: false }],
          }],
        }],
        charts: [],
        narratives: [{ type: 'heading', text: 'Valuation' }],
        footnotes: [],
        entities: { companies: ['AAPL'], dates: [], metrics: [] },
      }]);

      visionExtraction.flattenMetrics.mockReturnValue([
        { metric_key: 'revenue', raw_value: '$100M', numeric_value: 100, period: 'FY2024', is_estimate: false, is_negative: false, page_number: 1, table_type: 'comp-table', units: 'millions' },
      ]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      // Should have called vision extraction
      expect(visionExtraction.identifyKeyPages).toHaveBeenCalled();
      expect(visionExtraction.extractFromPages).toHaveBeenCalledWith(
        'raw-uploads/test.pdf',
        [1, 2, 5],
        'sell-side-report',
      );

      // Should have persisted metrics
      const metricInserts = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'metric'"),
      );
      expect(metricInserts.length).toBeGreaterThanOrEqual(1);

      // Should have persisted tables
      const tableInserts = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'table'"),
      );
      expect(tableInserts.length).toBeGreaterThanOrEqual(1);

      // Should have updated metric count
      const updateCalls = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE intel_documents'),
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip vision extraction for non-PDF files', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{
        s3_key: 'raw-uploads/test.xlsx',
        raw_text_s3_key: 'extracted/tenant/deal/doc/raw_text.txt',
        file_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        document_type: 'spreadsheet',
        file_name: 'model.xlsx',
      }]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(visionExtraction.extractFromPages).not.toHaveBeenCalled();
    });

    it('should handle document not found gracefully', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(visionExtraction.extractFromPages).not.toHaveBeenCalled();
    });

    it('should handle vision extraction failure without crashing', async () => {
      visionExtraction.extractFromPages.mockRejectedValue(new Error('Vision API timeout'));

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      // Should have recorded the error
      const errorUpdates = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('error ='),
      );
      expect(errorUpdates.length).toBeGreaterThanOrEqual(1);
    });

    it('should persist narratives from vision results', async () => {
      visionExtraction.extractFromPages.mockResolvedValue([{
        pageNumber: 3,
        tables: [],
        charts: [],
        narratives: [
          { type: 'heading', text: 'Key Risks' },
          { type: 'paragraph', text: 'Competition from cloud providers.' },
        ],
        footnotes: [],
        entities: { companies: [], dates: [], metrics: [] },
      }]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      const narrativeInserts = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'narrative'"),
      );
      expect(narrativeInserts.length).toBeGreaterThanOrEqual(1);
    });

    it('should persist footnotes from vision results', async () => {
      visionExtraction.extractFromPages.mockResolvedValue([{
        pageNumber: 5,
        tables: [],
        charts: [],
        narratives: [],
        footnotes: [
          { marker: '1', text: 'Based on consensus estimates' },
        ],
        entities: { companies: [], dates: [], metrics: [] },
      }]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      const footnoteInserts = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'footnote'"),
      );
      expect(footnoteInserts.length).toBeGreaterThanOrEqual(1);
    });

    it('should persist merged entities from all pages', async () => {
      visionExtraction.extractFromPages.mockResolvedValue([
        {
          pageNumber: 1,
          tables: [],
          charts: [],
          narratives: [],
          footnotes: [],
          entities: { companies: ['AAPL', 'MSFT'], dates: ['FY2024'], metrics: ['Revenue'] },
        },
        {
          pageNumber: 2,
          tables: [],
          charts: [],
          narratives: [],
          footnotes: [],
          entities: { companies: ['GOOGL'], dates: ['Q3 2024'], metrics: ['EBITDA'] },
        },
      ]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      const entityInserts = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes("'entity'"),
      );
      expect(entityInserts.length).toBeGreaterThanOrEqual(1);

      // Verify merged entities contain all companies
      const entityData = JSON.parse(entityInserts[0][4]);
      expect(entityData.companies).toContain('AAPL');
      expect(entityData.companies).toContain('GOOGL');
    });

    it('should skip enrichment when no key pages found', async () => {
      visionExtraction.identifyKeyPages.mockReturnValue([]);

      await service.enrichDocument(mockDocId, mockTenantId, mockDealId);

      expect(visionExtraction.extractFromPages).not.toHaveBeenCalled();
    });
  });
});
