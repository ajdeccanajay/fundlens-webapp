/**
 * Unit tests for Instant RAG Intake Summary Generation
 * 
 * Tests the generateIntakeSummaries method in InstantRAGService
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
 */

import { Test, TestingModule } from '@nestjs/testing';
import { InstantRAGService, IntakeSummary, DocumentCategory, HeadlineMetric } from '../../src/instant-rag/instant-rag.service';
import { SessionManagerService } from '../../src/instant-rag/session-manager.service';
import { DocumentProcessorService } from '../../src/instant-rag/document-processor.service';
import { FileValidatorService } from '../../src/instant-rag/file-validator.service';
import { BedrockService } from '../../src/rag/bedrock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ModelRouterService } from '../../src/instant-rag/model-router.service';
import { SyncEnvelopeGeneratorService } from '../../src/instant-rag/sync-envelope-generator.service';

describe('InstantRAGService - Intake Summary Generation', () => {
  let service: InstantRAGService;
  let bedrockService: jest.Mocked<BedrockService>;
  let prismaService: jest.Mocked<PrismaService>;

  const mockSessionId = '123e4567-e89b-12d3-a456-426614174000';
  const mockDocumentId = '223e4567-e89b-12d3-a456-426614174001';

  const mockDocument = {
    id: mockDocumentId,
    fileName: 'AAPL_10K_2024.pdf',
    fileType: 'pdf',
    fileSizeBytes: 5000000,
    contentHash: 'abc123',
    pageCount: 150,
    processingStatus: 'complete',
    extractedText: `
      APPLE INC.
      FORM 10-K
      For the fiscal year ended September 28, 2024
      
      PART I
      Item 1. Business
      Apple Inc. designs, manufactures, and markets smartphones, personal computers...
      
      PART II
      Item 7. Management's Discussion and Analysis
      Revenue was $383.3 billion for fiscal 2024...
      Net income was $97.0 billion...
      
      Item 8. Financial Statements
      Total Revenue: $383,285 million
      Net Income: $96,995 million
      Earnings Per Share: $6.42
    `,
    createdAt: new Date(),
  };

  const mockClaudeResponse = JSON.stringify({
    document_type: '10-K',
    reporting_entity: 'Apple Inc.',
    period_covered: 'Fiscal Year Ended September 28, 2024',
    key_sections_identified: ['Business', "Management's Discussion and Analysis", 'Financial Statements'],
    headline_metrics: [
      { metric: 'Total Revenue', value: '$383.3 billion', period: 'FY 2024' },
      { metric: 'Net Income', value: '$97.0 billion', period: 'FY 2024' },
      { metric: 'Earnings Per Share', value: '$6.42', period: 'FY 2024' },
    ],
    notable_items: [],
    extraction_confidence: 'high',
    extraction_notes: '',
  });

  beforeEach(async () => {
    const mockBedrockService = {
      invokeClaude: jest.fn(),
    };

    const mockPrismaService = {
      $queryRaw: jest.fn(),
    };

    const mockSessionManager = {
      getSession: jest.fn(),
      createSession: jest.fn(),
      extendTimeout: jest.fn(),
      setFilesTotal: jest.fn(),
      incrementFileCounters: jest.fn(),
      endSession: jest.fn(),
      getActiveSession: jest.fn(),
    };

    const mockDocumentProcessor = {
      processFile: jest.fn(),
    };

    const mockFileValidator = {
      validateBatch: jest.fn(),
    };

    const mockModelRouter = {
      routeQuery: jest.fn(),
      trackUsage: jest.fn(),
      checkOpusBudget: jest.fn(),
      detectTriggerKeyword: jest.fn(),
    };

    const mockSyncEnvelopeGenerator = {
      generateEnvelope: jest.fn(),
      uploadToS3: jest.fn(),
      triggerKBIngestion: jest.fn(),
      executeAsyncSync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstantRAGService,
        { provide: BedrockService, useValue: mockBedrockService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SessionManagerService, useValue: mockSessionManager },
        { provide: DocumentProcessorService, useValue: mockDocumentProcessor },
        { provide: FileValidatorService, useValue: mockFileValidator },
        { provide: ModelRouterService, useValue: mockModelRouter },
        { provide: SyncEnvelopeGeneratorService, useValue: mockSyncEnvelopeGenerator },
      ],
    }).compile();

    service = module.get<InstantRAGService>(InstantRAGService);
    bedrockService = module.get(BedrockService);
    prismaService = module.get(PrismaService);
  });

  describe('generateIntakeSummaries', () => {
    it('should generate intake summary for a single document', async () => {
      // Mock getSessionDocuments
      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument]) // getSessionDocuments
        .mockResolvedValueOnce([{ id: 'summary-id' }]); // storeIntakeSummary

      bedrockService.invokeClaude.mockResolvedValue(mockClaudeResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries).toHaveLength(1);
      expect(summaries[0].documentType).toBe('10-K');
      expect(summaries[0].reportingEntity).toBe('Apple Inc.');
      expect(summaries[0].periodCovered).toBe('Fiscal Year Ended September 28, 2024');
      expect(summaries[0].headlineMetrics).toHaveLength(3);
      expect(summaries[0].extractionConfidence).toBe('high');
    });

    it('should return empty array when no documents in session', async () => {
      prismaService.$queryRaw.mockResolvedValueOnce([]);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries).toHaveLength(0);
      expect(bedrockService.invokeClaude).not.toHaveBeenCalled();
    });

    it('should skip documents without extracted text', async () => {
      const docWithoutText = { ...mockDocument, extractedText: null };
      prismaService.$queryRaw.mockResolvedValueOnce([docWithoutText]);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries).toHaveLength(0);
      expect(bedrockService.invokeClaude).not.toHaveBeenCalled();
    });

    it('should skip documents with failed processing status', async () => {
      const failedDoc = { ...mockDocument, processingStatus: 'failed' };
      prismaService.$queryRaw.mockResolvedValueOnce([failedDoc]);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries).toHaveLength(0);
      expect(bedrockService.invokeClaude).not.toHaveBeenCalled();
    });

    it('should call Claude Sonnet with correct model ID', async () => {
      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(mockClaudeResponse);

      await service.generateIntakeSummaries(mockSessionId);

      expect(bedrockService.invokeClaude).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
          max_tokens: 2000,
        })
      );
    });

    it('should store summary in database', async () => {
      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(mockClaudeResponse);

      await service.generateIntakeSummaries(mockSessionId);

      // Verify storeIntakeSummary was called (second $queryRaw call)
      expect(prismaService.$queryRaw).toHaveBeenCalledTimes(2);
    });

    it('should continue processing other documents if one fails', async () => {
      const doc1 = { ...mockDocument, id: 'doc1', fileName: 'doc1.pdf' };
      const doc2 = { ...mockDocument, id: 'doc2', fileName: 'doc2.pdf' };

      prismaService.$queryRaw
        .mockResolvedValueOnce([doc1, doc2]) // getSessionDocuments
        .mockResolvedValueOnce([{ id: 'summary-id' }]); // storeIntakeSummary for doc2

      bedrockService.invokeClaude
        .mockRejectedValueOnce(new Error('Claude error')) // First doc fails
        .mockResolvedValueOnce(mockClaudeResponse); // Second doc succeeds

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      // Should have one summary from the second document
      expect(summaries).toHaveLength(1);
      expect(summaries[0].fileName).toBe('doc2.pdf');
    });
  });

  describe('parseIntakeSummaryResponse', () => {
    it('should handle JSON wrapped in markdown code blocks', async () => {
      const wrappedResponse = '```json\n' + mockClaudeResponse + '\n```';
      
      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(wrappedResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries).toHaveLength(1);
      expect(summaries[0].documentType).toBe('10-K');
    });

    it('should default to "other" for invalid document types', async () => {
      const invalidTypeResponse = JSON.stringify({
        ...JSON.parse(mockClaudeResponse),
        document_type: 'invalid_type',
      });

      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(invalidTypeResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries[0].documentType).toBe('other');
    });

    it('should default to "medium" for invalid confidence levels', async () => {
      const invalidConfidenceResponse = JSON.stringify({
        ...JSON.parse(mockClaudeResponse),
        extraction_confidence: 'very_high',
      });

      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(invalidConfidenceResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries[0].extractionConfidence).toBe('medium');
    });

    it('should return low confidence summary on parse error', async () => {
      const invalidJson = 'not valid json';

      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(invalidJson);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries[0].extractionConfidence).toBe('low');
      expect(summaries[0].documentType).toBe('other');
      expect(summaries[0].extractionNotes).toContain('Failed to parse');
    });

    it('should handle missing fields gracefully', async () => {
      const partialResponse = JSON.stringify({
        document_type: '10-K',
        reporting_entity: 'Apple Inc.',
        // Missing other fields
      });

      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(partialResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(summaries[0].documentType).toBe('10-K');
      expect(summaries[0].reportingEntity).toBe('Apple Inc.');
      expect(summaries[0].periodCovered).toBe('Unknown');
      expect(summaries[0].keySectionsIdentified).toEqual([]);
      expect(summaries[0].headlineMetrics).toEqual([]);
    });
  });

  describe('IntakeSummary structure validation', () => {
    it('should include all required fields in summary', async () => {
      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(mockClaudeResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);
      const summary = summaries[0];

      // Verify all required fields per Requirements 3.2-3.10
      expect(summary).toHaveProperty('documentId');
      expect(summary).toHaveProperty('documentIndex');
      expect(summary).toHaveProperty('fileName');
      expect(summary).toHaveProperty('documentType');
      expect(summary).toHaveProperty('reportingEntity');
      expect(summary).toHaveProperty('periodCovered');
      expect(summary).toHaveProperty('pageCount');
      expect(summary).toHaveProperty('keySectionsIdentified');
      expect(summary).toHaveProperty('headlineMetrics');
      expect(summary).toHaveProperty('notableItems');
      expect(summary).toHaveProperty('extractionConfidence');
      expect(summary).toHaveProperty('extractionNotes');
    });

    it('should validate headline metrics structure', async () => {
      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(mockClaudeResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);
      const metrics = summaries[0].headlineMetrics;

      expect(metrics).toBeInstanceOf(Array);
      metrics.forEach((metric: HeadlineMetric) => {
        expect(metric).toHaveProperty('metric');
        expect(metric).toHaveProperty('value');
        expect(metric).toHaveProperty('period');
        expect(typeof metric.metric).toBe('string');
        expect(typeof metric.value).toBe('string');
        expect(typeof metric.period).toBe('string');
      });
    });

    it('should validate document type is from allowed list', async () => {
      const validTypes: DocumentCategory[] = [
        '10-K', '10-Q', '8-K', 'earnings_transcript', 'investor_presentation',
        'CIM', 'pitch_deck', 'due_diligence_report', 'financial_model', 'other'
      ];

      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(mockClaudeResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(validTypes).toContain(summaries[0].documentType);
    });

    it('should validate extraction confidence is from allowed list', async () => {
      const validConfidence = ['high', 'medium', 'low'];

      prismaService.$queryRaw
        .mockResolvedValueOnce([mockDocument])
        .mockResolvedValueOnce([{ id: 'summary-id' }]);

      bedrockService.invokeClaude.mockResolvedValue(mockClaudeResponse);

      const summaries = await service.generateIntakeSummaries(mockSessionId);

      expect(validConfidence).toContain(summaries[0].extractionConfidence);
    });
  });

  describe('getIntakeSummaries', () => {
    it('should retrieve stored summaries for a session', async () => {
      const storedSummary = {
        id: 'summary-id',
        documentId: mockDocumentId,
        fileName: 'AAPL_10K_2024.pdf',
        documentType: '10-K',
        reportingEntity: 'Apple Inc.',
        periodCovered: 'Fiscal Year Ended September 28, 2024',
        pageCount: 150,
        keySectionsIdentified: ['Business', 'MD&A'],
        headlineMetrics: [{ metric: 'Revenue', value: '$383B', period: 'FY24' }],
        notableItems: [],
        extractionConfidence: 'high',
        extractionNotes: '',
      };

      prismaService.$queryRaw.mockResolvedValueOnce([storedSummary]);

      const summaries = await service.getIntakeSummaries(mockSessionId);

      expect(summaries).toHaveLength(1);
      expect(summaries[0].documentType).toBe('10-K');
      expect(summaries[0].reportingEntity).toBe('Apple Inc.');
    });
  });
});
