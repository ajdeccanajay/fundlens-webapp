# Phase 2: Document Extraction - Practical Implementation Plan

## Budget-Conscious Approach

Given your **$23/month budget**, we'll use a **smart tiered strategy**:

### Tier 1: Free/Cheap (Default for all documents)
- Text extraction: `pdf-parse`, `mammoth` (free)
- Simple table detection: Pattern matching (free)
- Regex-based metrics: Local processing (free)
- Basic metadata: PDF properties (free)

### Tier 2: AI-Enhanced (On-demand, user-triggered)
- Complex table parsing: Claude 3.5 Haiku ($0.01 per doc)
- Inline metric extraction: Claude 3.5 Haiku ($0.01 per doc)
- Chart data extraction: Claude 3.5 Sonnet Vision ($0.05 per chart)

**Cost Example** (25 documents):
- 25 docs × Tier 1 = $0 (free)
- 10 docs × Tier 2 tables = $0.10
- 5 docs × chart extraction (2 charts each) = $0.50
- **Total: $0.60 one-time** + ongoing query costs

## Implementation Strategy

### Week 1: Core Extraction (Days 3-7)

#### Day 3-4: Document Upload & Basic Extraction

**File**: `src/documents/document-upload.controller.ts`

```typescript
import { Controller, Post, UseInterceptors, UploadedFile, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentProcessingService } from './document-processing.service';

@Controller('api/documents')
export class DocumentUploadController {
  constructor(
    private readonly processingService: DocumentProcessingService
  ) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
      const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
      cb(null, allowed.includes(file.mimetype));
    }
  }))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      tenantId: string;
      ticker: string;
      extractionTier?: 'basic' | 'advanced';
    }
  ) {
    // Validate
    if (!file) throw new BadRequestException('No file uploaded');
    
    // Process asynchronously
    const document = await this.processingService.processDocument({
      file,
      tenantId: body.tenantId,
      ticker: body.ticker,
      extractionTier: body.extractionTier || 'basic'
    });
    
    return {
      documentId: document.id,
      status: 'processing',
      message: 'Document uploaded successfully'
    };
  }
}
```

**File**: `src/documents/document-processing.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../services/s3.service';
import { BedrockService } from '../rag/bedrock.service';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

@Injectable()
export class DocumentProcessingService {
  
  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private bedrockService: BedrockService
  ) {}
  
  async processDocument(params: {
    file: Express.Multer.File;
    tenantId: string;
    ticker: string;
    extractionTier: 'basic' | 'advanced';
  }) {
    const { file, tenantId, ticker, extractionTier } = params;
    
    // 1. Upload to S3
    const s3Key = `${tenantId}/${ticker}/user_uploads/${Date.now()}_${file.originalname}`;
    await this.s3Service.uploadFile(file.buffer, s3Key);
    
    // 2. Create document record
    const document = await this.prisma.document.create({
      data: {
        tenantId,
        ticker,
        title: file.originalname,
        fileType: this.getFileType(file.mimetype),
        documentType: 'user_upload',
        sourceType: 'USER_UPLOAD',
        s3Bucket: process.env.S3_BUCKET_NAME,
        s3Key,
        fileSize: BigInt(file.size),
        processed: false,
        createdBy: 'user' // TODO: Get from auth context
      }
    });
    
    // 3. Extract content (async)
    this.extractContent(document.id, file, extractionTier)
      .catch(error => {
        console.error('Extraction failed:', error);
        this.prisma.document.update({
          where: { id: document.id },
          data: { 
            processed: true,
            processingError: error.message 
          }
        });
      });
    
    return document;
  }
  
  private async extractContent(
    documentId: string,
    file: Express.Multer.File,
    tier: 'basic' | 'advanced'
  ) {
    // Update status
    await this.prisma.document.update({
      where: { id: documentId },
      data: { processed: false }
    });
    
    try {
      // Extract text
      const extractedText = await this.extractText(file);
      
      // Extract metadata
      const metadata = await this.extractMetadata(file, extractedText);
      
      // Chunk text
      const chunks = this.chunkText(extractedText);
      
      // Generate embeddings
      const embeddings = await this.generateEmbeddings(chunks);
      
      // Store chunks with embeddings
      await this.storeChunks(documentId, chunks, embeddings);
      
      // Advanced extraction (if requested)
      if (tier === 'advanced') {
        await this.advancedExtraction(documentId, file, extractedText);
      }
      
      // Mark as processed
      await this.prisma.document.update({
        where: { id: documentId },
        data: { 
          processed: true,
          metadata: metadata as any
        }
      });
      
    } catch (error) {
      throw error;
    }
  }
  
  private async extractText(file: Express.Multer.File): Promise<string> {
    const mimeType = file.mimetype;
    
    if (mimeType === 'application/pdf') {
      const pdfData = await pdfParse(file.buffer);
      return pdfData.text;
    } 
    else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      return result.value;
    } 
    else if (mimeType === 'text/plain') {
      return file.buffer.toString('utf-8');
    }
    
    throw new Error(`Unsupported file type: ${mimeType}`);
  }
  
  private async extractMetadata(
    file: Express.Multer.File,
    text: string
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
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0', // Cheapest
        max_tokens: 500
      });
      
      return JSON.parse(response);
    } catch (error) {
      // Fallback to basic metadata
      return {
        title: file.originalname,
        author: [],
        company: null,
        documentDate: null,
        documentType: 'other'
      };
    }
  }
  
  private chunkText(text: string): TextChunk[] {
    const chunks: TextChunk[] = [];
    const chunkSize = 1000;
    const overlap = 200;
    
    let start = 0;
    let chunkIndex = 0;
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      const content = text.substring(start, end);
      
      // Try to break at sentence boundary
      const lastPeriod = content.lastIndexOf('. ');
      const actualEnd = (lastPeriod > chunkSize * 0.8) ? start + lastPeriod + 1 : end;
      
      chunks.push({
        chunkIndex,
        content: text.substring(start, actualEnd).trim(),
        tokenCount: Math.ceil(content.length / 4) // Rough estimate
      });
      
      start = actualEnd - overlap;
      chunkIndex++;
    }
    
    return chunks;
  }
  
  private async generateEmbeddings(chunks: TextChunk[]): Promise<number[][]> {
    // Batch embeddings for efficiency
    const batchSize = 25;
    const embeddings: number[][] = [];
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchEmbeddings = await Promise.all(
        batch.map(chunk => this.bedrockService.generateEmbedding(chunk.content))
      );
      embeddings.push(...batchEmbeddings);
    }
    
    return embeddings;
  }
  
  private async storeChunks(
    documentId: string,
    chunks: TextChunk[],
    embeddings: number[][]
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId }
    });
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      
      // Store with raw SQL to handle vector type
      await this.prisma.$executeRaw`
        INSERT INTO document_chunks (
          id, document_id, tenant_id, ticker, chunk_index, 
          content, embedding, token_count, created_at
        ) VALUES (
          gen_random_uuid(),
          ${documentId},
          ${document.tenantId},
          ${document.ticker},
          ${chunk.chunkIndex},
          ${chunk.content},
          ${embedding}::vector,
          ${chunk.tokenCount},
          NOW()
        )
      `;
    }
  }
  
  private async advancedExtraction(
    documentId: string,
    file: Express.Multer.File,
    text: string
  ) {
    // Extract tables
    const tables = await this.extractTables(file, text);
    await this.storeTables(documentId, tables);
    
    // Extract inline metrics
    const metrics = await this.extractInlineMetrics(text);
    await this.storeMetrics(documentId, metrics);
    
    // Extract charts (if PDF with images)
    if (file.mimetype === 'application/pdf') {
      const charts = await this.extractCharts(file);
      await this.storeCharts(documentId, charts);
    }
  }
  
  private async extractTables(
    file: Express.Multer.File,
    text: string
  ): Promise<ExtractedTable[]> {
    // Simple table detection using patterns
    const tablePattern = /(\|[^\n]+\|[\s\S]*?\n\s*\n)/g;
    const matches = text.match(tablePattern) || [];
    
    if (matches.length === 0) return [];
    
    // For complex tables, use Claude
    const prompt = `Extract tables from this document text. Return as JSON array:

${text.substring(0, 5000)}

Format:
[
  {
    "tableIndex": 0,
    "headers": [["Header1", "Header2"]],
    "rows": [[{"value": "cell1"}, {"value": "cell2"}]],
    "detectedMetrics": ["Revenue", "EBITDA"]
  }
]`;
    
    try {
      const response = await this.bedrockService.invokeClaude({
        prompt,
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        max_tokens: 2000
      });
      
      return JSON.parse(response);
    } catch (error) {
      console.error('Table extraction failed:', error);
      return [];
    }
  }
  
  private async extractInlineMetrics(text: string): Promise<ExtractedMetric[]> {
    // Use Claude to extract metrics
    const prompt = `Extract all financial metrics from this text. Return ONLY valid JSON array:

${text.substring(0, 3000)}

Format:
[
  {
    "metricName": "Revenue",
    "value": 2500,
    "unit": "millions",
    "currency": "USD",
    "period": "Q4 2023",
    "context": "Revenue increased to $2.5B in Q4 2023"
  }
]`;
    
    try {
      const response = await this.bedrockService.invokeClaude({
        prompt,
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        max_tokens: 1500
      });
      
      return JSON.parse(response);
    } catch (error) {
      console.error('Metric extraction failed:', error);
      return [];
    }
  }
  
  private async extractCharts(file: Express.Multer.File): Promise<ExtractedChart[]> {
    // This would use Claude Vision - implement in Phase 2B
    // For now, return empty array
    return [];
  }
  
  private getFileType(mimeType: string): string {
    const map = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'text/plain': 'txt'
    };
    return map[mimeType] || 'unknown';
  }
}
```

#### Day 5: Storage & Retrieval

**Extend Prisma Schema** (already done in Phase 1, but add extraction tables):

```prisma
// Add to schema.prisma

model ExtractedTable {
  id              String   @id @default(uuid())
  documentId      String   @map("document_id")
  tenantId        String   @map("tenant_id")
  tableIndex      Int      @map("table_index")
  headers         Json
  rows            Json
  detectedMetrics String[] @map("detected_metrics")
  markdown        String   @db.Text
  createdAt       DateTime @default(now()) @map("created_at")
  
  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  
  @@map("extracted_tables")
  @@index([tenantId, documentId])
}

model ExtractedMetric {
  id               String   @id @default(uuid())
  documentId       String   @map("document_id")
  tenantId         String   @map("tenant_id")
  metricName       String   @map("metric_name")
  value            Decimal  @db.Decimal(20, 4)
  unit             String
  currency         String?
  period           String?
  context          String   @db.Text
  extractionMethod String   @map("extraction_method")
  confidence       Float    @default(0.8)
  createdAt        DateTime @default(now()) @map("created_at")
  
  document         Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  
  @@map("extracted_metrics")
  @@index([tenantId, documentId])
  @@index([metricName])
}
```

#### Day 6-7: Testing & Integration

**Test Script**: `scripts/test-document-upload.js`

```javascript
const FormData = require('form-data');
const fs = require('fs');
const axios = require('axios');

async function testUpload() {
  const form = new FormData();
  form.append('file', fs.createReadStream('./test-files/sample-pitch-deck.pdf'));
  form.append('tenantId', '00000000-0000-0000-0000-000000000000');
  form.append('ticker', 'AAPL');
  form.append('extractionTier', 'advanced');
  
  const response = await axios.post('http://localhost:3000/api/documents/upload', form, {
    headers: form.getHeaders()
  });
  
  console.log('Upload response:', response.data);
  
  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  // Check status
  const status = await axios.get(`http://localhost:3000/api/documents/${response.data.documentId}`);
  console.log('Processing status:', status.data);
}

testUpload();
```

## Cost Analysis

### Extraction Costs (25 documents)

**Tier 1 (Basic) - FREE**:
- Text extraction: Free (local libraries)
- Simple chunking: Free (local processing)
- Embeddings: $0.13 (25 docs × 50 chunks × $0.0001)

**Tier 2 (Advanced) - ON-DEMAND**:
- Metadata extraction: $0.25 (25 docs × $0.01)
- Table extraction: $0.10 (10 docs × $0.01)
- Metric extraction: $0.15 (15 docs × $0.01)
- Chart extraction: $0.50 (5 docs × 2 charts × $0.05)

**Total One-Time**: $1.13 for full advanced extraction of 25 documents

**Ongoing**: Only query costs (~$23/month for 1000 queries)

## Smart Defaults

```typescript
// Auto-detect when to use advanced extraction
class SmartExtractionDecider {
  
  shouldUseAdvanced(file: Express.Multer.File, text: string): boolean {
    // Use advanced if:
    // 1. File is PDF (likely has tables/charts)
    // 2. Text contains table markers
    // 3. Text contains financial terms
    
    const isPDF = file.mimetype === 'application/pdf';
    const hasTableMarkers = /\|[^\n]+\|/.test(text);
    const hasFinancialTerms = /(revenue|ebitda|income|margin|earnings)/i.test(text);
    
    return isPDF && (hasTableMarkers || hasFinancialTerms);
  }
}
```

## Next Steps

1. ✅ Implement basic text extraction
2. ✅ Implement chunking and embeddings
3. ✅ Implement metadata extraction with Claude Haiku
4. ⏳ Implement table extraction (basic + advanced)
5. ⏳ Implement inline metric extraction
6. ⏳ Add chart extraction with Claude Vision (Phase 2B)

## Success Metrics

- [ ] Upload PDF/DOCX/TXT successfully
- [ ] Extract text with 95%+ accuracy
- [ ] Generate embeddings for all chunks
- [ ] Extract metadata from documents
- [ ] Extract tables from financial documents
- [ ] Extract inline metrics with 80%+ accuracy
- [ ] Total cost < $2 for 25 documents

---

**This approach gives you institutional-grade extraction at consumer-grade prices!**
