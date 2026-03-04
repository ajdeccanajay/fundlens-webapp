import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../services/s3.service';
import { BedrockService } from '../rag/bedrock.service';
import * as mammoth from 'mammoth';

// pdf-parse has a default export, use dynamic import
const pdfParse = require('pdf-parse').default || require('pdf-parse');

interface ProcessDocumentParams {
  file: Express.Multer.File;
  tenantId: string;
  ticker: string;
  extractionTier: 'basic' | 'advanced';
  userId: string;
}

interface TextChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber?: number;
}

interface DocumentMetadata {
  title?: string;
  author?: string[];
  company?: string;
  documentDate?: string;
  documentType?: string;
  pageCount?: number;
}

interface ExtractedTable {
  tableIndex: number;
  headers: string[][];
  rows: any[][];
  detectedMetrics: string[];
  markdown: string;
}

interface ExtractedMetric {
  metricName: string;
  value: number;
  unit: string;
  currency?: string;
  period?: string;
  context: string;
  extractionMethod: string;
  confidence: number;
}

@Injectable()
export class DocumentProcessingService {
  private readonly logger = new Logger(DocumentProcessingService.name);

  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private bedrockService: BedrockService,
  ) {}

  async processDocument(params: ProcessDocumentParams) {
    const { file, tenantId, ticker, extractionTier, userId } = params;

    this.logger.log(`📤 Starting document upload: ${file.originalname} (${file.size} bytes)`);

    // 1. Upload to S3
    const s3Key = `${tenantId}/user_upload/${ticker}/${Date.now()}_${file.originalname}`;
    
    try {
      await this.s3Service.uploadFile(file, s3Key);
      this.logger.log(`✅ S3 upload successful: ${s3Key}`);
    } catch (error) {
      this.logger.error(`❌ S3 upload failed: ${error.message}`);
      throw error;
    }

    // 2. Create document record
    const document = await this.prisma.document.create({
      data: {
        tenantId,
        ticker,
        title: file.originalname,
        fileType: this.getFileType(file.mimetype),
        documentType: 'user_upload',
        sourceType: 'USER_UPLOAD',
        s3Bucket: process.env.S3_BUCKET_NAME || 'fundlens-documents-dev',
        s3Key,
        fileSize: BigInt(file.size),
        processed: false,
        createdBy: userId,
      },
    });

    this.logger.log(`✅ Document record created: ${document.id}`);

    // 3. Extract content asynchronously with proper error handling
    setImmediate(() => {
      this.extractContent(document.id, file, extractionTier).catch(async (error) => {
        this.logger.error(
          `❌ Extraction failed for document ${document.id}: ${error.message}`,
        );
        this.logger.error(`Stack trace: ${error.stack}`);
        
        try {
          await this.prisma.document.update({
            where: { id: document.id },
            data: {
              processed: true,
              processingError: error.message,
            },
          });
          this.logger.log(`✅ Error status saved for document ${document.id}`);
        } catch (updateError) {
          this.logger.error(`❌ Failed to update error status: ${updateError.message}`);
        }
      });
    });

    return document;
  }

  /**
   * Process an already-uploaded document by ID
   * Used when document is uploaded via DocumentsService
   */
  async processUploadedDocument(documentId: string, fileBuffer: Buffer, extractionTier: 'basic' | 'advanced' = 'basic') {
    this.logger.log(`📤 Starting processing for uploaded document: ${documentId}`);

    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    // Create a mock file object for extractContent
    const mockFile: Express.Multer.File = {
      buffer: fileBuffer,
      originalname: document.title,
      mimetype: this.getMimeType(document.fileType),
      size: Number(document.fileSize),
      fieldname: 'file',
      encoding: '7bit',
      destination: '',
      filename: document.title,
      path: '',
      stream: null as any,
    };

    // Extract content asynchronously
    setImmediate(() => {
      this.extractContent(document.id, mockFile, extractionTier).catch(async (error) => {
        this.logger.error(
          `❌ Extraction failed for document ${document.id}: ${error.message}`,
        );
        this.logger.error(`Stack trace: ${error.stack}`);
        
        try {
          await this.prisma.document.update({
            where: { id: document.id },
            data: {
              processed: true,
              processingError: error.message,
            },
          });
          this.logger.log(`✅ Error status saved for document ${document.id}`);
        } catch (updateError) {
          this.logger.error(`❌ Failed to update error status: ${updateError.message}`);
        }
      });
    });

    return { documentId, status: 'processing' };
  }

  private async extractContent(
    documentId: string,
    file: Express.Multer.File,
    tier: 'basic' | 'advanced',
  ) {
    const startTime = Date.now();
    this.logger.log(`🚀 Starting extraction for document ${documentId} (${tier} tier)`);
    this.logger.log(`   File: ${file.originalname}, Size: ${file.size} bytes, Type: ${file.mimetype}`);

    try {
      // Extract text with timeout
      this.logger.log(`📄 Step 1/6: Extracting text from ${file.mimetype}...`);
      const extractedText = await Promise.race([
        this.extractText(file),
        new Promise<string>((_, reject) => 
          setTimeout(() => reject(new Error('Text extraction timeout (30s)')), 30000)
        )
      ]);
      this.logger.log(`✅ Extracted ${extractedText.length} characters of text (${Math.round((Date.now() - startTime) / 1000)}s)`);

      if (extractedText.length === 0) {
        throw new Error('No text extracted from document');
      }

      // Extract metadata
      this.logger.log(`📋 Step 2/6: Extracting metadata...`);
      const metadata = await this.extractMetadata(file, extractedText);
      this.logger.log(`✅ Metadata extracted: ${JSON.stringify(metadata)}`);

      // Chunk text
      this.logger.log(`✂️  Step 3/6: Chunking text...`);
      const chunks = this.chunkText(extractedText);
      this.logger.log(`✅ Created ${chunks.length} chunks (avg ${Math.round(extractedText.length / chunks.length)} chars/chunk)`);

      if (chunks.length === 0) {
        throw new Error('No chunks created from text');
      }

      // Generate embeddings with timeout
      this.logger.log(`🧮 Step 4/6: Generating embeddings for ${chunks.length} chunks...`);
      const embeddings = await Promise.race([
        this.generateEmbeddings(chunks),
        new Promise<number[][]>((_, reject) => 
          setTimeout(() => reject(new Error('Embedding generation timeout (60s)')), 60000)
        )
      ]);
      this.logger.log(`✅ Generated ${embeddings.length} embeddings (${Math.round((Date.now() - startTime) / 1000)}s)`);

      // Store chunks with embeddings
      this.logger.log(`💾 Step 5/6: Storing ${chunks.length} chunks in database...`);
      await this.storeChunks(documentId, chunks, embeddings);
      this.logger.log(`✅ Stored ${chunks.length} chunks successfully`);

      // Advanced extraction (if requested)
      if (tier === 'advanced') {
        this.logger.log(`🔬 Step 6/6: Running advanced extraction...`);
        await this.advancedExtraction(documentId, file, extractedText);
        this.logger.log(`✅ Advanced extraction complete`);
      } else {
        this.logger.log(`⏭️  Step 6/6: Skipping advanced extraction (basic tier)`);
      }

      // Mark as processed
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          processed: true,
          metadata: metadata as any,
        },
      });

      const totalTime = Math.round((Date.now() - startTime) / 1000);
      this.logger.log(`🎉 Document ${documentId} processed successfully in ${totalTime}s`);
    } catch (error) {
      const totalTime = Math.round((Date.now() - startTime) / 1000);
      this.logger.error(`❌ Extraction error after ${totalTime}s: ${error.message}`);
      this.logger.error(`   Stack: ${error.stack}`);
      throw error;
    }
  }

  async extractText(file: Express.Multer.File): Promise<string> {
    const mimeType = file.mimetype;
    this.logger.log(`   Parsing ${mimeType} file (${file.size} bytes)...`);

    try {
      if (mimeType === 'application/pdf') {
        // pdf-parse expects a Buffer
        const pdfData = await pdfParse(file.buffer as any);
        this.logger.log(`   PDF parsed: ${pdfData.numpages} pages, ${pdfData.text.length} chars`);
        return pdfData.text;
      } else if (
        mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        this.logger.log(`   DOCX parsed: ${result.value.length} chars`);
        return result.value;
      } else if (mimeType === 'text/plain') {
        const text = file.buffer.toString('utf-8');
        this.logger.log(`   TXT parsed: ${text.length} chars`);
        return text;
      }

      throw new Error(`Unsupported file type: ${mimeType}`);
    } catch (error) {
      this.logger.error(`   Text extraction failed: ${error.message}`);
      throw new Error(`Failed to extract text from ${mimeType}: ${error.message}`);
    }
  }

  async extractMetadata(
    file: Express.Multer.File,
    text: string,
  ): Promise<DocumentMetadata> {
    // Extract first 2000 chars for metadata extraction
    const firstPage = text.substring(0, 2000);

    // Use Claude Haiku (cheap) to extract metadata
    const prompt = `Extract document metadata from this text. Return ONLY valid JSON, no other text:

${firstPage}

JSON format:
{
  "title": "document title",
  "author": ["author names"],
  "company": "company name",
  "documentDate": "YYYY-MM-DD or null",
  "documentType": "pitch-deck" | "financial-report" | "analysis" | "other"
}`;

    try {
      const response = await this.bedrockService.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        max_tokens: 500,
      });

      // Parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      throw new Error('No JSON found in response');
    } catch (error) {
      this.logger.warn(`Metadata extraction failed: ${error.message}`);
      // Fallback to basic metadata
      return {
        title: file.originalname,
        author: [],
        company: undefined,
        documentDate: undefined,
        documentType: 'other',
      };
    }
  }

  chunkText(text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    const chunkSize = 1000;
    const overlap = 200;

    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      let content = text.substring(start, end);

      // Try to break at sentence boundary
      if (end < text.length) {
        const lastPeriod = content.lastIndexOf('. ');
        const lastNewline = content.lastIndexOf('\n');
        const breakPoint = Math.max(lastPeriod, lastNewline);

        if (breakPoint > chunkSize * 0.7) {
          content = text.substring(start, start + breakPoint + 1);
        }
      }

      const trimmedContent = content.trim();
      if (trimmedContent.length > 0) {
        chunks.push({
          chunkIndex,
          content: trimmedContent,
          tokenCount: Math.ceil(trimmedContent.length / 4), // Rough estimate
        });
        chunkIndex++;
      }

      start += content.length - overlap;
    }

    return chunks;
  }

  async generateEmbeddings(chunks: TextChunk[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const batchSize = 25;

    this.logger.log(`   Generating embeddings in batches of ${batchSize}...`);

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(chunks.length / batchSize);
      
      this.logger.log(`   Batch ${batchNum}/${totalBatches}: Processing ${batch.length} chunks...`);
      
      try {
        const batchEmbeddings = await Promise.all(
          batch.map((chunk) =>
            this.bedrockService.generateEmbedding(chunk.content),
          ),
        );
        embeddings.push(...batchEmbeddings);
        this.logger.log(`   ✓ Batch ${batchNum}/${totalBatches} complete (${embeddings.length}/${chunks.length} total)`);
      } catch (error) {
        this.logger.error(`   ✗ Batch ${batchNum} failed: ${error.message}`);
        throw new Error(`Embedding generation failed at batch ${batchNum}: ${error.message}`);
      }
    }

    return embeddings;
  }

  private async storeChunks(
    documentId: string,
    chunks: TextChunk[],
    embeddings: number[][],
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    // Use direct SQL with proper escaping
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      // Convert embedding array to PostgreSQL vector format string
      const embeddingStr = `[${embedding.join(',')}]`;
      
      // Escape single quotes in content for SQL
      const escapedContent = chunk.content.replace(/'/g, "''");
      const escapedTicker = document.ticker ? document.ticker.replace(/'/g, "''") : null;

      // Use executeRawUnsafe with fully interpolated SQL (no parameters)
      await this.prisma.$executeRawUnsafe(`
        INSERT INTO document_chunks (
          id, document_id, tenant_id, ticker, chunk_index, 
          content, embedding, token_count, created_at
        ) VALUES (
          gen_random_uuid(),
          '${documentId}',
          '${document.tenantId}',
          ${escapedTicker ? `'${escapedTicker}'` : 'NULL'},
          ${chunk.chunkIndex},
          '${escapedContent}',
          '${embeddingStr}'::vector,
          ${chunk.tokenCount},
          NOW()
        )
      `);
    }
  }

  private async advancedExtraction(
    documentId: string,
    file: Express.Multer.File,
    text: string,
  ) {
    this.logger.log(`Starting advanced extraction for document ${documentId}`);

    // Extract tables
    const tables = await this.extractTables(text);
    if (tables.length > 0) {
      this.logger.log(`Extracted ${tables.length} tables`);
      // TODO: Store tables in database
    }

    // Extract inline metrics
    const metrics = await this.extractInlineMetrics(text);
    if (metrics.length > 0) {
      this.logger.log(`Extracted ${metrics.length} metrics`);
      // TODO: Store metrics in database
    }
  }

  async extractTables(text: string): Promise<ExtractedTable[]> {
    // Simple table detection using patterns
    const tablePattern = /(\|[^\n]+\|[\s\S]*?\n\s*\n)/g;
    const matches = text.match(tablePattern) || [];

    if (matches.length === 0) {
      return [];
    }

    // For complex tables, use Claude
    const prompt = `Extract tables from this document text. Return ONLY valid JSON array, no other text:

${text.substring(0, 5000)}

Format:
[
  {
    "tableIndex": 0,
    "headers": [["Header1", "Header2"]],
    "rows": [[{"value": "cell1"}, {"value": "cell2"}]],
    "detectedMetrics": ["Revenue", "EBITDA"],
    "markdown": "| Header1 | Header2 |\\n|---------|---------|\\n| cell1 | cell2 |"
  }
]`;

    try {
      const response = await this.bedrockService.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        max_tokens: 2000,
      });

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return [];
    } catch (error) {
      this.logger.warn(`Table extraction failed: ${error.message}`);
      return [];
    }
  }

  async extractInlineMetrics(text: string): Promise<ExtractedMetric[]> {
    // Use Claude to extract metrics
    const prompt = `Extract all financial metrics from this text. Return ONLY valid JSON array, no other text:

${text.substring(0, 3000)}

Format:
[
  {
    "metricName": "Revenue",
    "value": 2500,
    "unit": "millions",
    "currency": "USD",
    "period": "Q4 2023",
    "context": "Revenue increased to $2.5B in Q4 2023",
    "extractionMethod": "llm",
    "confidence": 0.9
  }
]`;

    try {
      const response = await this.bedrockService.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        max_tokens: 1500,
      });

      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      return [];
    } catch (error) {
      this.logger.warn(`Metric extraction failed: ${error.message}`);
      return [];
    }
  }

  private getFileType(mimeType: string): string {
    const map = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        'docx',
      'text/plain': 'txt',
    };
    return map[mimeType] || 'unknown';
  }

  private getMimeType(fileType: string): string {
    const map = {
      'pdf': 'application/pdf',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
    };
    return map[fileType] || 'application/octet-stream';
  }
}
