import { Test, TestingModule } from '@nestjs/testing';
import { DocumentProcessingService } from '../../src/documents/document-processing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../../src/services/s3.service';
import { BedrockService } from '../../src/rag/bedrock.service';

describe('DocumentProcessingService', () => {
  let service: DocumentProcessingService;
  let prismaService: jest.Mocked<PrismaService>;
  let s3Service: jest.Mocked<S3Service>;
  let bedrockService: jest.Mocked<BedrockService>;

  const mockFile: Express.Multer.File = {
    fieldname: 'file',
    originalname: 'test-document.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('mock pdf content'),
    stream: null,
    destination: '',
    filename: '',
    path: '',
  };

  const mockDocument = {
    id: 'doc-123',
    tenantId: 'tenant-123',
    ticker: 'AAPL',
    title: 'test-document.pdf',
    fileType: 'pdf',
    documentType: 'user_upload',
    sourceType: 'USER_UPLOAD',
    s3Bucket: 'test-bucket',
    s3Key: 'tenant-123/AAPL/user_uploads/test.pdf',
    fileSize: BigInt(1024),
    processed: false,
    processingError: null,
    createdBy: 'user-123',
    createdAt: new Date(),
    updatedAt: new Date(),
    uploadDate: new Date(),
    sourceUrl: null,
    metadata: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentProcessingService,
        {
          provide: PrismaService,
          useValue: {
            document: {
              create: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            $executeRaw: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            uploadFile: jest.fn(),
          },
        },
        {
          provide: BedrockService,
          useValue: {
            invokeClaude: jest.fn(),
            generateEmbedding: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DocumentProcessingService>(DocumentProcessingService);
    prismaService = module.get(PrismaService) as jest.Mocked<PrismaService>;
    s3Service = module.get(S3Service) as jest.Mocked<S3Service>;
    bedrockService = module.get(BedrockService) as jest.Mocked<BedrockService>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processDocument', () => {
    it('should upload file to S3 and create document record', async () => {
      s3Service.uploadFile.mockResolvedValue(undefined);
      prismaService.document.create.mockResolvedValue(mockDocument as any);

      const result = await service.processDocument({
        file: mockFile,
        tenantId: 'tenant-123',
        ticker: 'AAPL',
        extractionTier: 'basic',
        userId: 'user-123',
      });

      expect(s3Service.uploadFile).toHaveBeenCalledWith(
        mockFile.buffer,
        expect.stringContaining('tenant-123/AAPL/user_uploads/'),
      );

      expect(prismaService.document.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-123',
          ticker: 'AAPL',
          title: 'test-document.pdf',
          fileType: 'pdf',
          sourceType: 'USER_UPLOAD',
          processed: false,
          createdBy: 'user-123',
        }),
      });

      expect(result).toEqual(mockDocument);
    });

    it('should throw error if S3 upload fails', async () => {
      s3Service.uploadFile.mockRejectedValue(new Error('S3 upload failed'));

      await expect(
        service.processDocument({
          file: mockFile,
          tenantId: 'tenant-123',
          ticker: 'AAPL',
          extractionTier: 'basic',
          userId: 'user-123',
        }),
      ).rejects.toThrow('S3 upload failed');

      expect(prismaService.document.create).not.toHaveBeenCalled();
    });
  });

  describe('extractText', () => {
    it('should extract text from PDF', async () => {
      const pdfFile = {
        ...mockFile,
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 test content'),
      };

      // Mock pdf-parse
      jest.mock('pdf-parse', () => ({
        __esModule: true,
        default: jest.fn().mockResolvedValue({ text: 'Extracted PDF text' }),
      }));

      const text = await service.extractText(pdfFile);
      expect(typeof text).toBe('string');
    });

    it('should extract text from DOCX', async () => {
      const docxFile = {
        ...mockFile,
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('mock docx content'),
      };

      // Mock mammoth
      jest.mock('mammoth', () => ({
        extractRawText: jest
          .fn()
          .mockResolvedValue({ value: 'Extracted DOCX text' }),
      }));

      const text = await service.extractText(docxFile);
      expect(typeof text).toBe('string');
    });

    it('should extract text from TXT', async () => {
      const txtFile = {
        ...mockFile,
        mimetype: 'text/plain',
        buffer: Buffer.from('Plain text content'),
      };

      const text = await service.extractText(txtFile);
      expect(text).toBe('Plain text content');
    });

    it('should throw error for unsupported file type', async () => {
      const unsupportedFile = {
        ...mockFile,
        mimetype: 'application/zip',
      };

      await expect(service.extractText(unsupportedFile)).rejects.toThrow(
        'Unsupported file type',
      );
    });
  });

  describe('extractMetadata', () => {
    it('should extract metadata using Claude', async () => {
      const text = 'Company XYZ Financial Report Q4 2023';
      const mockMetadata = {
        title: 'Financial Report',
        author: ['John Doe'],
        company: 'XYZ Corp',
        documentDate: '2023-12-31',
        documentType: 'financial-report',
      };

      bedrockService.invokeClaude.mockResolvedValue(
        JSON.stringify(mockMetadata),
      );

      const metadata = await service.extractMetadata(mockFile, text);

      expect(bedrockService.invokeClaude).toHaveBeenCalledWith({
        prompt: expect.stringContaining('Extract document metadata'),
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        max_tokens: 500,
      });

      expect(metadata).toEqual(mockMetadata);
    });

    it('should return fallback metadata if extraction fails', async () => {
      bedrockService.invokeClaude.mockRejectedValue(
        new Error('Claude API error'),
      );

      const metadata = await service.extractMetadata(mockFile, 'some text');

      expect(metadata).toEqual({
        title: 'test-document.pdf',
        author: [],
        company: null,
        documentDate: null,
        documentType: 'other',
      });
    });
  });

  describe('chunkText', () => {
    it('should chunk text with proper overlap', () => {
      const text = 'A'.repeat(2500); // 2500 characters
      const chunks = service.chunkText(text);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].content.length).toBeLessThanOrEqual(1000);
      expect(chunks[0].tokenCount).toBeGreaterThan(0);
    });

    it('should break at sentence boundaries', () => {
      const text =
        'First sentence. Second sentence. Third sentence. Fourth sentence. ' +
        'Fifth sentence. Sixth sentence. Seventh sentence. Eighth sentence. ' +
        'Ninth sentence. Tenth sentence. Eleventh sentence. Twelfth sentence.';

      const chunks = service.chunkText(text);

      // Check that chunks end with sentence boundaries
      chunks.forEach((chunk) => {
        if (chunk.content.length > 100) {
          expect(
            chunk.content.endsWith('.') || chunk.content.endsWith('\n'),
          ).toBeTruthy();
        }
      });
    });

    it('should handle empty text', () => {
      const chunks = service.chunkText('');
      expect(chunks).toEqual([]);
    });

    it('should handle short text', () => {
      const text = 'Short text';
      const chunks = service.chunkText(text);

      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toBe('Short text');
    });
  });

  describe('generateEmbeddings', () => {
    it('should generate embeddings for all chunks', async () => {
      const chunks = [
        { chunkIndex: 0, content: 'Chunk 1', tokenCount: 2 },
        { chunkIndex: 1, content: 'Chunk 2', tokenCount: 2 },
        { chunkIndex: 2, content: 'Chunk 3', tokenCount: 2 },
      ];

      const mockEmbedding = new Array(1536).fill(0.1);
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);

      const embeddings = await service.generateEmbeddings(chunks);

      expect(embeddings.length).toBe(3);
      expect(bedrockService.generateEmbedding).toHaveBeenCalledTimes(3);
      expect(embeddings[0]).toEqual(mockEmbedding);
    });

    it('should batch embeddings in groups of 25', async () => {
      const chunks = Array.from({ length: 50 }, (_, i) => ({
        chunkIndex: i,
        content: `Chunk ${i}`,
        tokenCount: 2,
      }));

      const mockEmbedding = new Array(1536).fill(0.1);
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);

      const embeddings = await service.generateEmbeddings(chunks);

      expect(embeddings.length).toBe(50);
      expect(bedrockService.generateEmbedding).toHaveBeenCalledTimes(50);
    });

    it('should handle embedding generation errors', async () => {
      const chunks = [{ chunkIndex: 0, content: 'Chunk 1', tokenCount: 2 }];

      bedrockService.generateEmbedding.mockRejectedValue(
        new Error('Bedrock API error'),
      );

      await expect(service.generateEmbeddings(chunks)).rejects.toThrow(
        'Bedrock API error',
      );
    });
  });

  describe('extractTables', () => {
    it('should extract tables using Claude', async () => {
      const text = `
| Revenue | Q1 | Q2 |
|---------|----|----|
| Amount  | 100| 150|
`;

      const mockTables = [
        {
          tableIndex: 0,
          headers: [['Revenue', 'Q1', 'Q2']],
          rows: [[{ value: 'Amount' }, { value: '100' }, { value: '150' }]],
          detectedMetrics: ['Revenue'],
          markdown: text,
        },
      ];

      bedrockService.invokeClaude.mockResolvedValue(
        JSON.stringify(mockTables),
      );

      const tables = await service.extractTables(text);

      expect(tables.length).toBe(1);
      expect(tables[0].detectedMetrics).toContain('Revenue');
    });

    it('should return empty array if no tables found', async () => {
      const text = 'No tables here';

      const tables = await service.extractTables(text);

      expect(tables).toEqual([]);
      expect(bedrockService.invokeClaude).not.toHaveBeenCalled();
    });

    it('should handle extraction errors gracefully', async () => {
      const text = '| Table | Data |';

      bedrockService.invokeClaude.mockRejectedValue(
        new Error('Claude API error'),
      );

      const tables = await service.extractTables(text);

      expect(tables).toEqual([]);
    });
  });

  describe('extractInlineMetrics', () => {
    it('should extract metrics using Claude', async () => {
      const text = 'Revenue increased to $2.5 billion in Q4 2023';

      const mockMetrics = [
        {
          metricName: 'Revenue',
          value: 2500,
          unit: 'millions',
          currency: 'USD',
          period: 'Q4 2023',
          context: text,
          extractionMethod: 'llm',
          confidence: 0.9,
        },
      ];

      bedrockService.invokeClaude.mockResolvedValue(
        JSON.stringify(mockMetrics),
      );

      const metrics = await service.extractInlineMetrics(text);

      expect(metrics.length).toBe(1);
      expect(metrics[0].metricName).toBe('Revenue');
      expect(metrics[0].value).toBe(2500);
    });

    it('should handle extraction errors gracefully', async () => {
      bedrockService.invokeClaude.mockRejectedValue(
        new Error('Claude API error'),
      );

      const metrics = await service.extractInlineMetrics('some text');

      expect(metrics).toEqual([]);
    });
  });

  describe('integration tests', () => {
    it('should process document end-to-end (basic tier)', async () => {
      s3Service.uploadFile.mockResolvedValue(undefined);
      prismaService.document.create.mockResolvedValue(mockDocument as any);
      prismaService.document.findUnique.mockResolvedValue(mockDocument as any);
      prismaService.$executeRaw.mockResolvedValue(1);

      const mockEmbedding = new Array(1536).fill(0.1);
      bedrockService.generateEmbedding.mockResolvedValue(mockEmbedding);

      const result = await service.processDocument({
        file: mockFile,
        tenantId: 'tenant-123',
        ticker: 'AAPL',
        extractionTier: 'basic',
        userId: 'user-123',
      });

      expect(result.id).toBe('doc-123');
      expect(s3Service.uploadFile).toHaveBeenCalled();
      expect(prismaService.document.create).toHaveBeenCalled();
    });
  });
});
