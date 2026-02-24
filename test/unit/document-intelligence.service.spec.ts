/**
 * DocumentIntelligenceService — Unit Tests
 * Tests Session 1 implementation: Spec §3.1, §3.2, §9, §10.1
 *
 * Coverage:
 *   - processInstantIntelligence (5-second hot path)
 *   - getDocumentStatus (polling endpoint)
 *   - createUploadUrl (presigned URL + record creation)
 *   - classifyAndExtract (Haiku LLM call)
 *   - extractText (pdf/docx/xlsx/csv/txt parsing)
 *   - persistHeadlineMetrics (document_extractions writes)
 *   - Error handling / graceful fallback
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DocumentIntelligenceService } from '../../src/documents/document-intelligence.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { S3Service } from '../../src/services/s3.service';

// Mock pdf-parse before the service is imported (it uses require at module scope)
jest.mock('pdf-parse', () => {
  const mockPdfParse = jest.fn().mockResolvedValue({ text: 'Extracted PDF text content for testing', numpages: 5 });
  mockPdfParse.default = mockPdfParse;
  return mockPdfParse;
});

describe('DocumentIntelligenceService', () => {
  let service: DocumentIntelligenceService;
  let prisma: jest.Mocked<PrismaService>;
  let bedrock: jest.Mocked<BedrockService>;
  let s3: jest.Mocked<S3Service>;

  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockDealId = '22222222-2222-2222-2222-222222222222';
  const mockDocId = '33333333-3333-3333-3333-333333333333';

  beforeEach(async () => {
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
            invokeClaude: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            getFileBuffer: jest.fn(),
            uploadBuffer: jest.fn().mockResolvedValue({ key: 'test-key', bucket: 'test' }),
            getSignedUploadUrl: jest.fn().mockResolvedValue('https://s3.presigned.url/upload'),
          },
        },
      ],
    }).compile();

    service = module.get(DocumentIntelligenceService);
    prisma = module.get(PrismaService);
    bedrock = module.get(BedrockService);
    s3 = module.get(S3Service);
  });

  // ─── processInstantIntelligence ────────────────────────────────

  describe('processInstantIntelligence', () => {
    const pdfBuffer = Buffer.from('fake pdf content for testing');

    beforeEach(() => {
      // Mock S3 file retrieval
      s3.getFileBuffer.mockResolvedValue(pdfBuffer);

      // Mock Haiku classification response
      bedrock.invokeClaude.mockResolvedValue(JSON.stringify({
        documentType: 'sell-side-report',
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        summary: 'Goldman Sachs initiating coverage on Apple Inc.',
        metrics: [
          { metric_key: 'price_target', raw_value: '$275', numeric_value: 275, period: 'FY2025E', is_estimate: true },
          { metric_key: 'rating', raw_value: 'Overweight', numeric_value: null, period: null, is_estimate: false },
        ],
        suggestedQuestions: [
          'What is the price target?',
          'What are the key risks?',
          'What is the revenue forecast?',
        ],
      }));
    });

    it('should return instant intelligence result within expected structure', async () => {
      const result = await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test-report.pdf',
        mockTenantId, mockDealId,
      );

      expect(result).toMatchObject({
        documentId: mockDocId,
        documentType: 'sell-side-report',
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        summary: expect.stringContaining('Goldman Sachs'),
        fileName: 'test-report.pdf',
      });
      expect(result.headlineMetrics).toHaveLength(2);
      expect(result.suggestedQuestions).toHaveLength(3);
    });

    it('should extract text from S3 before classification', async () => {
      await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      expect(s3.getFileBuffer).toHaveBeenCalledWith('raw-uploads/test.pdf');
    });

    it('should call Haiku (not Sonnet) for classification', async () => {
      await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      expect(bedrock.invokeClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
          temperature: 0,
          max_tokens: 1024,
        }),
      );
    });

    it('should store raw text to S3 for long-context fallback', async () => {
      await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      expect(s3.uploadBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.stringContaining(`extracted/${mockTenantId}/${mockDealId}/${mockDocId}/raw_text.txt`),
        'text/plain',
      );
    });

    it('should update document status to queryable with long-context-fallback mode', async () => {
      await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE intel_documents SET"),
        'sell-side-report',
        expect.stringContaining('raw_text.txt'),
        'AAPL',
        'Apple Inc.',
        expect.any(Number), // page count
        mockDocId,
      );
    });

    it('should persist headline metrics to intel_document_extractions', async () => {
      await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      // 2 metrics + 1 metric_count update = at least 3 calls after the UPDATE
      const insertCalls = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO intel_document_extractions'),
      );
      expect(insertCalls).toHaveLength(2);
    });

    it('should gracefully handle classification failure', async () => {
      bedrock.invokeClaude.mockRejectedValue(new Error('Bedrock timeout'));

      const result = await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      expect(result.documentType).toBe('generic');
      expect(result.summary).toContain('classification unavailable');
      expect(result.suggestedQuestions).toHaveLength(3);
    });

    it('should handle malformed JSON from Haiku gracefully', async () => {
      bedrock.invokeClaude.mockResolvedValue('not valid json at all');

      const result = await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      expect(result.documentType).toBe('generic');
      expect(result.headlineMetrics).toHaveLength(0);
    });

    it('should strip markdown fencing from Haiku response', async () => {
      bedrock.invokeClaude.mockResolvedValue(
        '```json\n{"documentType":"ic-memo","companyName":"Tesla","ticker":"TSLA","summary":"IC memo","metrics":[],"suggestedQuestions":[]}\n```',
      );

      const result = await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'application/pdf', 'test.pdf',
        mockTenantId, mockDealId,
      );

      expect(result.documentType).toBe('ic-memo');
      expect(result.ticker).toBe('TSLA');
    });

    it('should handle empty text extraction (image-only PDF)', async () => {
      s3.getFileBuffer.mockResolvedValue(Buffer.from(''));

      const result = await service.processInstantIntelligence(
        mockDocId, 'raw-uploads/test.pdf', 'image/png', 'chart.png',
        mockTenantId, mockDealId,
      );

      // Should still classify (with empty text) and return a result
      expect(result.documentId).toBe(mockDocId);
    });
  });

  // ─── getDocumentStatus ─────────────────────────────────────────

  describe('getDocumentStatus', () => {
    it('should return document status when found', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{
        document_id: mockDocId,
        status: 'queryable',
        processing_mode: 'long-context-fallback',
        document_type: 'sell-side-report',
        chunk_count: null,
        metric_count: 3,
        error: null,
        updated_at: new Date('2026-02-24'),
      }]);

      const status = await service.getDocumentStatus(mockDocId);

      expect(status).toMatchObject({
        documentId: mockDocId,
        status: 'queryable',
        processingMode: 'long-context-fallback',
        documentType: 'sell-side-report',
        metricCount: 3,
      });
    });

    it('should return null when document not found', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const status = await service.getDocumentStatus('nonexistent-id');
      expect(status).toBeNull();
    });
  });

  // ─── createUploadUrl ───────────────────────────────────────────

  describe('createUploadUrl', () => {
    beforeEach(() => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([{ id: mockDocId }]);
    });

    it('should generate a presigned URL and document ID', async () => {
      const result = await service.createUploadUrl({
        fileName: 'report.pdf',
        fileType: 'application/pdf',
        fileSize: 1024000,
        tenantId: mockTenantId,
        dealId: mockDealId,
        uploadSource: 'chat',
      });

      expect(result.uploadUrl).toBe('https://s3.presigned.url/upload');
      expect(result.documentId).toBe(mockDocId);
    });

    it('should insert a document record with uploading status', async () => {
      await service.createUploadUrl({
        fileName: 'report.pdf',
        fileType: 'application/pdf',
        fileSize: 1024000,
        tenantId: mockTenantId,
        dealId: mockDealId,
        uploadSource: 'chat',
      });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO intel_documents'),
        mockDocId,
        mockTenantId,
        mockDealId,
        null, // chatSessionId
        'report.pdf',
        'application/pdf',
        1024000,
        expect.stringContaining('raw-uploads/'),
        'chat',
      );
    });

    it('should include chatSessionId when provided', async () => {
      const sessionId = '44444444-4444-4444-4444-444444444444';
      await service.createUploadUrl({
        fileName: 'report.pdf',
        fileType: 'application/pdf',
        fileSize: 1024000,
        tenantId: mockTenantId,
        dealId: mockDealId,
        chatSessionId: sessionId,
        uploadSource: 'chat',
      });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        sessionId,
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should use correct S3 key pattern per spec §6.3', async () => {
      await service.createUploadUrl({
        fileName: 'analysis.xlsx',
        fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: 500000,
        tenantId: mockTenantId,
        dealId: mockDealId,
        uploadSource: 'deal-library',
      });

      const insertCall = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO intel_documents'),
      );
      const s3Key = insertCall[8]; // 8th positional arg is s3_key
      expect(s3Key).toMatch(new RegExp(`raw-uploads/${mockTenantId}/${mockDealId}/${mockDocId}/analysis.xlsx`));
    });
  });

  // ─── Text extraction edge cases ────────────────────────────────

  describe('extractText (via processInstantIntelligence)', () => {
    beforeEach(() => {
      bedrock.invokeClaude.mockResolvedValue(JSON.stringify({
        documentType: 'generic', companyName: null, ticker: null,
        summary: 'Document', metrics: [], suggestedQuestions: [],
      }));
    });

    it('should handle text/plain files', async () => {
      s3.getFileBuffer.mockResolvedValue(Buffer.from('Plain text content here'));

      const result = await service.processInstantIntelligence(
        mockDocId, 'test.txt', 'text/plain', 'notes.txt', mockTenantId, mockDealId,
      );

      expect(result.documentId).toBe(mockDocId);
      // The prompt sent to Haiku should contain the text
      const promptArg = bedrock.invokeClaude.mock.calls[0][0].prompt;
      expect(promptArg).toContain('Plain text content here');
    });

    it('should handle CSV files', async () => {
      s3.getFileBuffer.mockResolvedValue(Buffer.from('Name,Value\nRevenue,100M'));

      const result = await service.processInstantIntelligence(
        mockDocId, 'test.csv', 'text/csv', 'data.csv', mockTenantId, mockDealId,
      );

      expect(result.documentId).toBe(mockDocId);
    });

    it('should handle image files (empty text extraction)', async () => {
      s3.getFileBuffer.mockResolvedValue(Buffer.from('fake image bytes'));

      const result = await service.processInstantIntelligence(
        mockDocId, 'chart.png', 'image/png', 'chart.png', mockTenantId, mockDealId,
      );

      expect(result.documentId).toBe(mockDocId);
    });
  });

  // ─── Headline metric parsing edge cases ────────────────────────

  describe('headline metric parsing', () => {
    beforeEach(() => {
      s3.getFileBuffer.mockResolvedValue(Buffer.from('test content'));
    });

    it('should handle camelCase metric keys from Haiku', async () => {
      bedrock.invokeClaude.mockResolvedValue(JSON.stringify({
        documentType: 'sell-side-report',
        companyName: 'NVDA',
        ticker: 'NVDA',
        summary: 'Report',
        metrics: [
          { metricKey: 'priceTarget', rawValue: '$150', numericValue: 150, period: 'FY2025E', isEstimate: true },
        ],
        suggestedQuestions: [],
      }));

      const result = await service.processInstantIntelligence(
        mockDocId, 'test.pdf', 'application/pdf', 'test.pdf', mockTenantId, mockDealId,
      );

      expect(result.headlineMetrics[0].metric_key).toBe('priceTarget');
      expect(result.headlineMetrics[0].raw_value).toBe('$150');
      expect(result.headlineMetrics[0].is_estimate).toBe(true);
    });

    it('should handle metrics with null numeric values', async () => {
      bedrock.invokeClaude.mockResolvedValue(JSON.stringify({
        documentType: 'sell-side-report',
        companyName: 'Test',
        ticker: 'TEST',
        summary: 'Report',
        metrics: [
          { metric_key: 'rating', raw_value: 'Buy', numeric_value: null, period: null, is_estimate: false },
        ],
        suggestedQuestions: [],
      }));

      const result = await service.processInstantIntelligence(
        mockDocId, 'test.pdf', 'application/pdf', 'test.pdf', mockTenantId, mockDealId,
      );

      expect(result.headlineMetrics[0].numeric_value).toBeNull();
    });

    it('should handle empty metrics array', async () => {
      bedrock.invokeClaude.mockResolvedValue(JSON.stringify({
        documentType: 'generic',
        companyName: null,
        ticker: null,
        summary: 'Generic document',
        metrics: [],
        suggestedQuestions: ['What is this about?'],
      }));

      const result = await service.processInstantIntelligence(
        mockDocId, 'test.pdf', 'application/pdf', 'test.pdf', mockTenantId, mockDealId,
      );

      expect(result.headlineMetrics).toHaveLength(0);
      // Should NOT call INSERT INTO intel_document_extractions
      const insertCalls = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO intel_document_extractions'),
      );
      expect(insertCalls).toHaveLength(0);
    });
  });

  // ─── Document type classification coverage ─────────────────────

  describe('document type classification', () => {
    beforeEach(() => {
      s3.getFileBuffer.mockResolvedValue(Buffer.from('test content'));
    });

    const docTypes = [
      'sell-side-report', 'ic-memo', 'pe-cim', 'earnings-transcript',
      'sec-10k', 'sec-10q', 'sec-8k', 'sec-proxy', 'fund-mandate',
      'spreadsheet', 'presentation', 'generic',
    ];

    for (const docType of docTypes) {
      it(`should handle documentType: ${docType}`, async () => {
        bedrock.invokeClaude.mockResolvedValue(JSON.stringify({
          documentType: docType, companyName: 'Test', ticker: 'TST',
          summary: `A ${docType}`, metrics: [], suggestedQuestions: [],
        }));

        const result = await service.processInstantIntelligence(
          mockDocId, 'test.pdf', 'application/pdf', 'test.pdf', mockTenantId, mockDealId,
        );

        expect(result.documentType).toBe(docType);
      });
    }
  });
});
