# FundLens Document Intelligence Pipeline — Full Implementation Spec

## For: Kiro Implementation
## Author: Architecture Review (Claude + Ajay)
## Date: February 27, 2026

---

## Executive Summary

This spec fixes FundLens's document upload and processing pipeline end-to-end. It addresses three compounding issues:

1. **Memory crashes**: PDF files flowing through the NestJS server cause OOM kills. Fix: presigned S3 uploads (PDF bytes never touch the server).
2. **Vision extraction OOM**: `pdf-to-img` uses canvas/pdfjs which causes uncatchable V8 aborts. Fix: replace with `pdf-lib` + native Bedrock PDF document blocks.
3. **Pipeline completion**: Documents get stuck at various stages. Fix: bulletproof Phase A → B → C with proper error handling, fallbacks, and status tracking.

The result: analysts upload a PDF and can query it within 3-5 seconds (long-context fallback), with full vector search + vision extraction completing in 60-90 seconds, and Bedrock KB sync within 5 minutes.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                             │
│                                                                     │
│  1. User selects file                                               │
│  2. Client calls POST /documents/request-upload                     │
│  3. Server returns presigned S3 POST URL + formFields               │
│  4. Client POSTs file directly to S3 (FormData)                     │
│  5. Client calls POST /documents/upload-complete                    │
│  6. Server triggers pipeline, returns documentId                    │
│  7. Client polls GET /documents/:id/status (or SSE)                 │
└──────────┬──────────────────────────────────────┬───────────────────┘
           │                                      │
           ▼                                      ▼
┌─────────────────────┐              ┌─────────────────────────────┐
│   S3 Bucket          │              │  NestJS Server               │
│                      │              │                              │
│  uploads/            │              │  Phase A: Instant Intel      │
│    {tenant}/{deal}/  │◄─────────── │    - Text extraction          │
│      {docId}.pdf     │  read only  │    - Haiku classification     │
│                      │             │    - Headline metrics          │
│  extracted/          │             │    - status → queryable        │
│    {docId}/pages/    │             │    (3-5 seconds)               │
│                      │             │                                │
│  kb-ready/           │             │  Phase B: Background Enrich   │
│    {tenant}/{deal}/  │             │    - Chunking + embeddings     │
│      chunks/         │             │    - Vision extraction (NEW)   │
└─────────────────────┘             │    - Metric verification       │
                                     │    - status → fully-indexed    │
                                     │    (30-90 seconds)             │
                                     │                                │
                                     │  Phase C: KB Sync              │
                                     │    - Chunks → S3 kb-ready/     │
                                     │    - Bedrock KB ingestion      │
                                     │    - kb_sync_status → synced   │
                                     │    (1-5 minutes)               │
                                     └────────────────────────────────┘
```

---

## Part 1: Presigned Upload (Eliminate Server Memory Pressure)

### Why

Currently, file uploads flow through the NestJS server: client → server → S3. The server holds the entire PDF buffer in memory during upload and initial processing. On a memory-constrained environment, this causes OOM kills. The GAAB pattern (which Ajay built at AWS) proves the better approach: client uploads directly to S3 via presigned POST URLs.

### New Endpoints

#### `POST /documents/request-upload`

Client calls this BEFORE uploading. Server generates presigned S3 POST credentials.

```typescript
// documents.controller.ts

@Post('request-upload')
@UseGuards(AuthGuard)
async requestUpload(
  @Body() body: RequestUploadDto,
  @Req() req: AuthenticatedRequest,
): Promise<RequestUploadResponse> {
  const { fileName, contentType, fileSize, dealId } = body;
  const tenantId = req.user.tenantId;
  const documentId = uuidv4();

  // Validate file
  if (fileSize > 100 * 1024 * 1024) {
    throw new BadRequestException('File size exceeds 100MB limit');
  }
  if (!['application/pdf', 'text/plain', 'text/csv'].includes(contentType)) {
    throw new BadRequestException('Unsupported file type');
  }

  // Generate S3 key with tenant isolation
  const s3Key = `uploads/${tenantId}/${dealId}/${documentId}/${fileName}`;

  // Create presigned POST
  const presigned = await this.s3Service.createPresignedPost({
    Bucket: process.env.DOCUMENTS_BUCKET,
    Key: s3Key,
    Conditions: [
      ['content-length-range', 0, 100 * 1024 * 1024], // Max 100MB
      ['eq', '$Content-Type', contentType],
    ],
    Fields: {
      'Content-Type': contentType,
      key: s3Key,
    },
    Expires: 300, // 5 minutes
  });

  // Create document record in RDS (status = 'uploading')
  await this.documentService.createDocumentRecord({
    id: documentId,
    tenantId,
    dealId,
    fileName,
    contentType,
    fileSize,
    s3Key,
    status: 'uploading',
    processingMode: null,
    kbSyncStatus: 'pending',
  });

  return {
    documentId,
    uploadUrl: presigned.url,
    formFields: presigned.fields,
    expiresIn: 300,
  };
}
```

#### `POST /documents/upload-complete`

Client calls this AFTER successful S3 upload. Triggers the processing pipeline.

```typescript
@Post('upload-complete')
@UseGuards(AuthGuard)
async uploadComplete(
  @Body() body: UploadCompleteDto,
  @Req() req: AuthenticatedRequest,
): Promise<UploadCompleteResponse> {
  const { documentId } = body;
  const tenantId = req.user.tenantId;

  // Verify document belongs to this tenant
  const doc = await this.documentService.getDocument(documentId, tenantId);
  if (!doc) throw new NotFoundException('Document not found');

  // Verify file exists in S3
  const exists = await this.s3Service.headObject({
    Bucket: process.env.DOCUMENTS_BUCKET,
    Key: doc.s3Key,
  });
  if (!exists) throw new BadRequestException('File not found in S3');

  // Update status
  await this.documentService.updateStatus(documentId, 'processing');

  // Trigger Phase A (synchronous — must complete before response)
  const phaseAResult = await this.documentPipelineService.processInstantIntelligence(
    documentId,
    tenantId,
    doc.dealId,
    doc.s3Key,
  );

  // Trigger Phase B + C (asynchronous — fire and forget)
  this.documentPipelineService.processBackgroundEnrichment(
    documentId,
    tenantId,
    doc.dealId,
    doc.s3Key,
  ).catch(err => {
    this.logger.error(`Background enrichment failed for ${documentId}: ${err.message}`);
  });

  return {
    documentId,
    status: 'queryable',
    documentType: phaseAResult.documentType,
    headlineMetrics: phaseAResult.metrics,
    processingMode: 'long-context-fallback',
  };
}
```

### Frontend Upload Flow

Adapt from the GAAB `fileUploadService.ts` pattern:

```typescript
// frontend: documentUploadService.ts

export async function uploadDocument(
  file: File,
  dealId: string,
  onProgress?: (progress: number) => void,
): Promise<UploadResult> {
  // Step 1: Request presigned URL
  const { documentId, uploadUrl, formFields } = await api.post(
    '/documents/request-upload',
    {
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
      dealId,
    },
  );

  // Step 2: Upload directly to S3
  const formData = new FormData();
  Object.entries(formFields).forEach(([key, value]) => {
    formData.append(key, value as string);
  });
  formData.append('file', file); // File MUST be last

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress((event.loaded / event.total) * 100);
        }
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`S3 upload failed: ${xhr.status}`));
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.open('POST', uploadUrl);
    xhr.send(formData);
  });

  // Step 3: Notify server upload is complete, triggers pipeline
  const result = await api.post('/documents/upload-complete', { documentId });

  return {
    documentId: result.documentId,
    status: result.status,
    documentType: result.documentType,
    headlineMetrics: result.headlineMetrics,
  };
}
```

### S3 Service Addition

```typescript
// s3.service.ts — add createPresignedPost method

import { createPresignedPost as s3CreatePresignedPost } from '@aws-sdk/s3-presigned-post';

async createPresignedPost(params: {
  Bucket: string;
  Key: string;
  Conditions: any[];
  Fields: Record<string, string>;
  Expires: number;
}): Promise<{ url: string; fields: Record<string, string> }> {
  return s3CreatePresignedPost(this.s3Client, {
    Bucket: params.Bucket,
    Key: params.Key,
    Conditions: params.Conditions,
    Fields: params.Fields,
    Expires: params.Expires,
  });
}
```

### Dependencies

```bash
npm install @aws-sdk/s3-presigned-post
```

### CORS Configuration for S3 Bucket

The documents S3 bucket needs CORS configured to allow direct browser uploads:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://app.fundlens.com", "http://localhost:3000"],
      "AllowedMethods": ["POST", "PUT", "GET"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

---

## Part 2: Vision Extraction Fix (Eliminate pdf-to-img OOM)

### Why

`pdf-to-img` uses canvas/pdfjs internally, which loads the entire PDF into V8 memory at high resolution. This causes uncatchable OOM aborts — not recoverable with try/catch. The fix: Bedrock Claude accepts PDF documents natively as `document` content blocks. No image conversion needed.

### Remove pdf-to-img

```bash
npm uninstall pdf-to-img
# Also remove canvas/pdfjs-dist if they were only peer deps of pdf-to-img
```

### Install pdf-lib

```bash
npm install pdf-lib
```

`pdf-lib` is pure JavaScript, no native dependencies, no canvas. It handles loading PDFs, counting pages, copying individual pages into new PDFs. Memory footprint: ~50-100MB for a 100-page PDF.

### Replace vision-extraction.service.ts

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { BedrockService } from '../bedrock/bedrock.service';
import { S3Service } from '../s3/s3.service';

interface PageExtractionResult {
  original_page_number: number;
  page_type: string;
  section_heading: string;
  has_tables: boolean;
  has_charts: boolean;
  tables: TableExtraction[];
  charts: ChartExtraction[];
  metrics: MetricExtraction[];
  narrative_content: string;
  footnotes: string[];
}

interface TableExtraction {
  table_type: string;
  title: string;
  headers: string[];
  rows: string[][];
  footnotes: string[];
}

interface ChartExtraction {
  chart_type: string;
  title: string;
  description: string;
  data_points: { label: string; value: string; series?: string }[];
}

interface MetricExtraction {
  metric_name: string;
  value: number;
  unit: string;
  period: string;
  context: string;
}

export interface VisionExtractionResult {
  documentId: string;
  pages: PageExtractionResult[];
  extractionMode: 'pdf-native' | 'text-only';
}

@Injectable()
export class VisionExtractionService {
  private readonly logger = new Logger(VisionExtractionService.name);
  private readonly BATCH_SIZE = 5; // Pages per Bedrock call
  private readonly TIMEOUT_MS = 90_000; // 90 second timeout per batch
  private readonly MAX_KEY_PAGES = 15;

  constructor(
    private readonly bedrockService: BedrockService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Main entry point. Attempts PDF-native vision extraction,
   * falls back to text-only if Bedrock call fails.
   */
  async extractWithVision(
    documentId: string,
    s3Key: string,
    rawText: string,
  ): Promise<VisionExtractionResult> {
    try {
      return await this.extractWithBedrockPdf(documentId, s3Key, rawText);
    } catch (error) {
      this.logger.warn(
        `Vision extraction failed for ${documentId}, falling back to text-only: ${error.message}`,
      );
      return await this.extractFromTextOnly(documentId, rawText);
    }
  }

  /**
   * PRIMARY PATH: Send PDF pages directly to Bedrock Claude as document blocks.
   * No image conversion. No canvas. No OOM.
   */
  private async extractWithBedrockPdf(
    documentId: string,
    s3Key: string,
    rawText: string,
  ): Promise<VisionExtractionResult> {
    // 1. Download PDF from S3 (streaming, not full buffer if possible)
    const pdfBuffer = await this.s3Service.getObject(s3Key);

    // 2. Identify key pages from raw text (existing logic)
    const keyPages = await this.identifyKeyPages(rawText);
    this.logger.log(
      `Document ${documentId}: ${keyPages.length} key pages identified`,
    );

    // 3. Load with pdf-lib (lightweight, pure JS)
    const sourcePdf = await PDFDocument.load(pdfBuffer);
    const totalPages = sourcePdf.getPageCount();

    // 4. Process key pages in batches
    const results: PageExtractionResult[] = [];

    for (let i = 0; i < keyPages.length; i += this.BATCH_SIZE) {
      const batch = keyPages.slice(i, i + this.BATCH_SIZE);

      // Create a mini-PDF with just these pages
      const batchPdf = await PDFDocument.create();
      const actualPageNumbers: number[] = [];

      for (const pageNum of batch) {
        if (pageNum < totalPages) {
          const [copiedPage] = await batchPdf.copyPages(sourcePdf, [pageNum]);
          batchPdf.addPage(copiedPage);
          actualPageNumbers.push(pageNum);
        }
      }

      if (actualPageNumbers.length === 0) continue;

      const batchBytes = await batchPdf.save();
      const batchBase64 = Buffer.from(batchBytes).toString('base64');

      // Send to Bedrock with timeout
      try {
        const batchResults = await this.callBedrockWithTimeout(
          batchBase64,
          actualPageNumbers,
          totalPages,
        );
        results.push(...batchResults);
      } catch (batchError) {
        this.logger.warn(
          `Batch ${i / this.BATCH_SIZE + 1} failed for ${documentId}: ${batchError.message}`,
        );
        // Continue with other batches — partial extraction is better than none
      }

      // Release batch memory
      // (batchBytes and batchBase64 are eligible for GC after this iteration)
    }

    this.logger.log(
      `Vision extraction complete for ${documentId}: ${results.length} pages extracted`,
    );

    return {
      documentId,
      pages: results,
      extractionMode: 'pdf-native',
    };
  }

  /**
   * Call Bedrock Claude with a PDF document block.
   * Wrapped with AbortController timeout.
   */
  private async callBedrockWithTimeout(
    pdfBase64: string,
    pageNumbers: number[],
    totalPages: number,
  ): Promise<PageExtractionResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

    try {
      const response = await this.bedrockService.invokeModel(
        {
          modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
          body: {
            anthropic_version: 'bedrock-2023-05-31',
            max_tokens: 8192,
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'document',
                    source: {
                      type: 'base64',
                      media_type: 'application/pdf',
                      data: pdfBase64,
                    },
                  },
                  {
                    type: 'text',
                    text: this.buildExtractionPrompt(pageNumbers, totalPages),
                  },
                ],
              },
            ],
          },
        },
        { signal: controller.signal }, // Pass abort signal
      );

      const text = response.content[0].text;
      const parsed = JSON.parse(text);
      return parsed.pages || [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * FALLBACK PATH: Extract structured data from raw text only.
   * Misses charts and visual tables but captures text-based data.
   */
  private async extractFromTextOnly(
    documentId: string,
    rawText: string,
  ): Promise<VisionExtractionResult> {
    const truncatedText = rawText.substring(0, 80_000); // Stay within token limits

    const response = await this.bedrockService.invokeModel({
      modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      body: {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 8192,
        system: `You are a financial document extraction specialist. Extract all structured financial data from this document text. Focus on tables (even ASCII/text-based ones), metrics, and key financial figures. Respond ONLY with valid JSON matching the schema provided.`,
        messages: [
          {
            role: 'user',
            content: `Extract all financial data from this document text into structured JSON.

Output format:
{
  "pages": [
    {
      "original_page_number": 0,
      "page_type": "<type>",
      "section_heading": "<heading>",
      "has_tables": true/false,
      "has_charts": false,
      "tables": [...],
      "charts": [],
      "metrics": [...],
      "narrative_content": "<key content>",
      "footnotes": [...]
    }
  ]
}

Document text:
${truncatedText}`,
          },
        ],
      },
    });

    const parsed = JSON.parse(response.content[0].text);
    return {
      documentId,
      pages: parsed.pages || [],
      extractionMode: 'text-only',
    };
  }

  /**
   * Identify which pages are most likely to contain financial data.
   * Uses raw text heuristics — no PDF rendering needed.
   */
  private async identifyKeyPages(rawText: string): Promise<number[]> {
    // Financial page indicators
    const indicators = [
      /consolidated\s+statements?\s+of\s+(income|operations|financial)/i,
      /balance\s+sheet/i,
      /cash\s+flow/i,
      /stockholders['']?\s+equity/i,
      /revenue|total\s+revenue|net\s+revenue/i,
      /operating\s+(income|loss|expenses)/i,
      /earnings\s+per\s+share/i,
      /segment\s+(information|data|results)/i,
      /management['']?s?\s+discussion/i,
      /risk\s+factors/i,
      /fair\s+value/i,
      /goodwill|intangible/i,
      /debt|borrowings|credit\s+facility/i,
      /comparison|comparable|comp\s+table/i,
      /price\s+target|rating|recommendation/i,
      /ebitda|adjusted\s+ebitda/i,
    ];

    // Simple page detection from text (split on form-feed or page markers)
    const pages = rawText.split(/\f|\n{4,}/);
    const keyPageIndices: number[] = [];

    for (let i = 0; i < pages.length && keyPageIndices.length < this.MAX_KEY_PAGES; i++) {
      const pageText = pages[i];
      const matchCount = indicators.filter((regex) => regex.test(pageText)).length;
      if (matchCount >= 2) {
        keyPageIndices.push(i);
      }
    }

    // If we found fewer than 5, include first pages (cover, TOC often have useful data)
    if (keyPageIndices.length < 5) {
      for (let i = 0; i < Math.min(5, pages.length); i++) {
        if (!keyPageIndices.includes(i)) {
          keyPageIndices.push(i);
        }
      }
    }

    return keyPageIndices.sort((a, b) => a - b).slice(0, this.MAX_KEY_PAGES);
  }

  /**
   * Build the extraction prompt for Bedrock Claude vision.
   */
  private buildExtractionPrompt(
    pageNumbers: number[],
    totalPages: number,
  ): string {
    const pageList = pageNumbers.map((p) => p + 1).join(', ');

    return `You are a financial document extraction specialist for FundLens, an AI-powered equity research platform. You are viewing pages ${pageList} of a ${totalPages}-page financial document.

For EACH page in this PDF, extract the following as a JSON object:

{
  "pages": [
    {
      "original_page_number": <1-indexed page number in the full document>,
      "page_type": "<one of: financial_statements, income_statement, balance_sheet, cash_flow, md_and_a, risk_factors, notes_to_financials, segment_data, comp_table, executive_compensation, guidance, cover, toc, chart_page, appendix, other>",
      "section_heading": "<the section this page falls under>",
      "has_tables": <true/false>,
      "has_charts": <true/false>,
      "tables": [
        {
          "table_type": "<financial_statement, comp_table, segment_breakdown, sensitivity_analysis, peer_comparison, fee_schedule, capitalization, other>",
          "title": "<table title or inferred description>",
          "headers": ["<column headers>"],
          "rows": [["<cell values — preserve exact numbers, no rounding>"]],
          "footnotes": ["<any footnotes referenced>"]
        }
      ],
      "charts": [
        {
          "chart_type": "<bar, line, pie, waterfall, stacked, combo, other>",
          "title": "<chart title>",
          "description": "<detailed description including all data points, trends, axis labels>",
          "data_points": [{"label": "<x-axis>", "value": "<y-axis>", "series": "<series name>"}]
        }
      ],
      "metrics": [
        {
          "metric_name": "<standardized: total_revenue, net_income, ebitda, eps, gross_profit, operating_income, free_cash_flow, total_assets, total_debt, etc.>",
          "value": <numeric value — exact, no rounding>,
          "unit": "<USD, %, ratio, bps, etc.>",
          "period": "<e.g., FY2024, Q3 2024, TTM>",
          "context": "<qualifiers: pro forma, adjusted, excluding items, as reported, etc.>"
        }
      ],
      "narrative_content": "<key text: management commentary, risk disclosures, forward-looking statements — summarized>",
      "footnotes": ["<any footnotes on this page>"]
    }
  ]
}

CRITICAL RULES:
1. Preserve EXACT numbers. Do not round or estimate. A single wrong number destroys analyst credibility.
2. For tables: capture EVERY row and column. Do not summarize or truncate.
3. For charts: extract all visible data points. Describe trends quantitatively.
4. Note footnote markers (*, †, (1), (a)) and capture footnote text.
5. Respond ONLY with valid JSON. No preamble, no markdown backticks.`;
  }
}
```

### Memory Impact

| Approach | Memory for 30-page PDF | Failure Mode |
|----------|----------------------|--------------|
| pdf-to-img (scale 2.0) | 2-8 GB (V8 canvas) | Uncatchable OOM abort |
| pdf-to-img (scale 1.0) | 1-4 GB (V8 canvas) | Uncatchable OOM abort |
| pdf-lib + Bedrock PDF | ~50-100 MB | Catchable API errors |

---

## Part 3: Phase A — Instant Intelligence (3-5 seconds)

Phase A runs synchronously during `upload-complete`. The document becomes queryable via long-context fallback before the response returns.

### Flow

```
upload-complete endpoint
  │
  ├── 1. Read raw text from S3 (pdf-parse for text extraction)
  │      NOTE: Do NOT load the full PDF buffer into memory.
  │      Use streaming or read just the text layer.
  │
  ├── 2. Haiku classification
  │      - Document type (10-K, 10-Q, 8-K, sell-side-report, earnings-call, etc.)
  │      - Company ticker
  │      - Filing period
  │
  ├── 3. Headline metric extraction (Haiku)
  │      - Price target, rating, revenue, net income, EBITDA
  │      - Store in intel_document_extractions (extraction_type='headline')
  │
  ├── 4. Store raw text for long-context fallback
  │      - raw_text column on intel_documents (or S3 reference)
  │
  ├── 5. Update status
  │      - status = 'queryable'
  │      - processing_mode = 'long-context-fallback'
  │
  └── Return to client
```

### Text Extraction Without Loading Full PDF

```typescript
// Use pdf-parse for text extraction — much lighter than pdf-to-img
import * as pdfParse from 'pdf-parse';

async extractRawText(s3Key: string): Promise<string> {
  const pdfBuffer = await this.s3Service.getObject(s3Key);
  const result = await pdfParse(pdfBuffer);
  return result.text;
}
```

Note: `pdf-parse` uses pdfjs internally but only for text extraction — it doesn't render to canvas, so memory usage is minimal (~100-200MB for large PDFs).

---

## Part 4: Phase B — Background Enrichment (30-90 seconds)

Phase B runs asynchronously after Phase A completes. It must be bulletproof — errors in any substep should not crash the process or block other steps.

### Flow

```
processBackgroundEnrichment()
  │
  ├── 1. Chunking
  │      - Financial-aware chunking (don't split tables, sections, or metric blocks)
  │      - 500-1000 token chunks with 100-token overlap
  │      - Store in intel_document_chunks
  │
  ├── 2. Embedding generation
  │      - Titan V2 (amazon.titan-embed-text-v2:0)
  │      - MUST specify dimensions: 1024 explicitly
  │      - Store 1024-dim vectors in intel_document_chunks.embedding
  │
  ├── 3. Vision extraction (NEW — pdf-lib + Bedrock PDF)
  │      - Process key pages through Bedrock Claude Sonnet
  │      - Store tables → intel_document_extractions (type='vision_table')
  │      - Store charts → intel_document_extractions (type='vision_chart')
  │      - Store metrics → intel_document_extractions (type='vision_metric')
  │      - FALLBACK: text-only extraction if Bedrock call fails
  │
  ├── 4. Deterministic verification (optional, can defer)
  │      - Cross-check vision-extracted metrics against headline metrics
  │      - Flag discrepancies for analyst review
  │      - Update verified=true on confirmed extractions
  │
  └── 5. Update status
         - status = 'fully-indexed'
         - processing_mode = 'fully-indexed'
```

### Error Handling — Must Be Bulletproof

```typescript
async processBackgroundEnrichment(
  documentId: string,
  tenantId: string,
  dealId: string,
  s3Key: string,
): Promise<void> {
  const rawText = await this.extractRawText(s3Key);

  // Step 1: Chunking + Embeddings
  try {
    const chunks = await this.chunkingService.chunkDocument(documentId, rawText);
    await this.embeddingService.generateAndStoreEmbeddings(documentId, chunks);
    this.logger.log(`Chunking + embedding complete for ${documentId}: ${chunks.length} chunks`);
  } catch (error) {
    this.logger.error(`Chunking failed for ${documentId}: ${error.message}`);
    // Don't return — continue to vision extraction even if chunking fails
  }

  // Step 2: Vision Extraction
  try {
    const visionResult = await this.visionExtractionService.extractWithVision(
      documentId,
      s3Key,
      rawText,
    );
    await this.storeVisionResults(documentId, visionResult);
    this.logger.log(
      `Vision extraction complete for ${documentId}: ${visionResult.pages.length} pages, mode=${visionResult.extractionMode}`,
    );
  } catch (error) {
    this.logger.error(`Vision extraction failed for ${documentId}: ${error.message}`);
    // Continue — document is still queryable via chunks and long-context
  }

  // Step 3: Update status
  try {
    await this.documentService.updateStatus(documentId, 'fully-indexed');
    await this.documentService.updateProcessingMode(documentId, 'fully-indexed');
  } catch (error) {
    this.logger.error(`Status update failed for ${documentId}: ${error.message}`);
  }

  // Step 4: Trigger Phase C (KB Sync)
  try {
    await this.processKBSync(documentId, tenantId, dealId);
  } catch (error) {
    this.logger.error(`KB sync failed for ${documentId}: ${error.message}`);
    // KB sync failure is non-critical — document is fully functional via pgvector
  }
}
```

### Storing Vision Extraction Results

```typescript
private async storeVisionResults(
  documentId: string,
  visionResult: VisionExtractionResult,
): Promise<void> {
  for (const page of visionResult.pages) {
    // Store tables
    for (const table of page.tables) {
      await this.documentExtractionRepo.save({
        document_id: documentId,
        extraction_type: 'vision_table',
        extraction_key: `${page.page_type}_${table.table_type}_p${page.original_page_number}`,
        extraction_value: table,
        page_number: page.original_page_number,
        verified: false,
        extraction_mode: visionResult.extractionMode,
      });
    }

    // Store charts
    for (const chart of page.charts) {
      await this.documentExtractionRepo.save({
        document_id: documentId,
        extraction_type: 'vision_chart',
        extraction_key: `${chart.chart_type}_p${page.original_page_number}`,
        extraction_value: chart,
        page_number: page.original_page_number,
        verified: false,
        extraction_mode: visionResult.extractionMode,
      });
    }

    // Store individual metrics
    for (const metric of page.metrics) {
      await this.documentExtractionRepo.save({
        document_id: documentId,
        extraction_type: 'vision_metric',
        extraction_key: `${metric.metric_name}_${metric.period}`,
        extraction_value: metric,
        page_number: page.original_page_number,
        verified: false,
        extraction_mode: visionResult.extractionMode,
      });
    }
  }
}
```

---

## Part 5: Phase C — KB Sync (1-5 minutes)

### Flow

```
processKBSync()
  │
  ├── 1. Read all chunks from intel_document_chunks
  │
  ├── 2. Write each chunk as a text file to S3 kb-ready/ prefix
  │      Key: kb-ready/{tenantId}/{dealId}/{documentId}/chunk_{index}.txt
  │      Include metadata headers in each file
  │
  ├── 3. Update kb_sync_status = 'prepared'
  │
  ├── 4. Trigger Bedrock KB data source sync
  │      (StartIngestionJob API)
  │
  └── 5. Poll or webhook for completion
         Update kb_sync_status = 'synced'
```

### Fix: prepareKBChunks Must Write ALL Chunks

The current bug: only 1 chunk makes it to S3 instead of 24. Ensure the loop iterates all chunks:

```typescript
async prepareKBChunks(
  documentId: string,
  tenantId: string,
  dealId: string,
): Promise<number> {
  const chunks = await this.chunkRepo.find({
    where: { document_id: documentId },
    order: { chunk_index: 'ASC' },
  });

  if (chunks.length === 0) {
    this.logger.warn(`No chunks found for ${documentId}, skipping KB prep`);
    return 0;
  }

  let written = 0;
  for (const chunk of chunks) {
    const key = `kb-ready/${tenantId}/${dealId}/${documentId}/chunk_${chunk.chunk_index}.txt`;

    // Include metadata as headers for Bedrock KB to use in filtering
    const content = [
      `document_id: ${documentId}`,
      `tenant_id: ${tenantId}`,
      `deal_id: ${dealId}`,
      `chunk_index: ${chunk.chunk_index}`,
      `page_numbers: ${chunk.page_numbers?.join(',') || 'unknown'}`,
      `section_type: ${chunk.section_type || 'unknown'}`,
      `---`,
      chunk.content,
    ].join('\n');

    await this.s3Service.putObject({
      Bucket: process.env.DOCUMENTS_BUCKET,
      Key: key,
      Body: content,
      ContentType: 'text/plain',
    });

    written++;
  }

  await this.documentService.updateKBSyncStatus(documentId, 'prepared');
  this.logger.log(`KB prep complete for ${documentId}: ${written} chunks written to S3`);
  return written;
}
```

---

## Part 6: RAG Source Integration

With all three phases complete, the RAG service has four sources to draw from:

```
User Query
  │
  ├── Source 1: Deterministic Metric Lookup
  │   Query: intel_document_extractions WHERE extraction_type IN
  │          ('headline', 'vision_metric') AND document.deal_id = ?
  │   Use: "What was Apple's revenue in FY2024?"
  │
  ├── Source 2: pgvector Semantic Search
  │   Query: intel_document_chunks with cosine similarity
  │   Use: "What did management say about margin pressure?"
  │
  ├── Source 3: Bedrock KB Search (after Phase C)
  │   Query: Bedrock RetrieveAndGenerate with tenant/deal filter
  │   Use: Cross-document queries across all deal library docs
  │
  └── Source 4: Long-Context Fallback
      Query: Stuff full raw_text into LLM context window
      Use: When Sources 1-3 don't have enough, or document just uploaded
```

The intent router (existing three-layer system) decides which sources to query based on query classification.

---

## Part 7: Dependency Changes Summary

```
REMOVE:
  pdf-to-img
  canvas (if only peer dep of pdf-to-img)

ADD:
  pdf-lib                     # Lightweight PDF manipulation, pure JS
  @aws-sdk/s3-presigned-post  # Presigned POST URL generation

KEEP:
  pdf-parse                   # Text extraction (used in Phase A)
  @aws-sdk/client-s3          # S3 operations
  @aws-sdk/client-bedrock-runtime  # Bedrock model invocation
```

---

## Part 8: Database Changes

### Existing migration (already written): `20260225_fix_embedding_dimensions.sql`

```sql
ALTER TABLE intel_document_chunks
  ALTER COLUMN embedding TYPE vector(1024);
```

### New: Add extraction_mode column

```sql
ALTER TABLE intel_document_extractions
  ADD COLUMN IF NOT EXISTS extraction_mode VARCHAR(20) DEFAULT 'unknown';
-- Values: 'headline', 'pdf-native', 'text-only'

ALTER TABLE intel_document_extractions
  ADD COLUMN IF NOT EXISTS page_number INTEGER;
```

### New: Add presigned upload tracking

```sql
ALTER TABLE intel_documents
  ADD COLUMN IF NOT EXISTS upload_method VARCHAR(20) DEFAULT 'direct';
-- Values: 'direct' (old server-passthrough), 'presigned' (new S3-direct)
```

---

## Part 9: Testing Plan

### Unit Tests

1. **Presigned upload flow**: Mock S3 `createPresignedPost`, verify correct key structure with tenant isolation
2. **Vision extraction**: Mock Bedrock responses, verify JSON parsing and storage into `intel_document_extractions`
3. **Vision fallback**: Simulate Bedrock failure, verify text-only extraction runs
4. **KB sync**: Verify ALL chunks written to S3 (not just first), correct key paths
5. **Fix broken mocks**: Update `background-enrichment.service.spec.ts` (2 broken mocks)

### Integration Tests

1. Upload a 5-page PDF via presigned URL → verify Phase A completes in <5 seconds
2. Wait for Phase B → verify vision extraction results in DB with correct types
3. Wait for Phase C → verify all chunks in S3 `kb-ready/` prefix
4. Query "What is revenue?" → verify Source 1 returns metric from vision extraction
5. Query "What did management discuss?" → verify Source 2 returns semantic chunks

### Edge Cases

1. Malformed PDF → verify graceful fallback to text-only
2. Empty PDF → verify no crash, appropriate error message
3. 100-page PDF → verify batching works (20 batches of 5), no OOM
4. Bedrock rate limit → verify retry with exponential backoff
5. S3 presigned URL expired → verify client gets clear error

---

## Part 10: Implementation Order

Execute in this order to minimize risk and maximize unblocking:

```
Session 1 (2 hours):
  ✅ Run existing migration (fix vector dimensions)
  ✅ Fix KB sync (prepareKBChunks — write ALL chunks)
  ✅ Fix broken test mocks
  ✅ Reprocess existing 2 documents
  ✅ Commit everything that works

Session 2 (3 hours):
  ✅ Replace vision-extraction.service.ts (pdf-lib + Bedrock PDF)
  ✅ Remove pdf-to-img dependency
  ✅ Install pdf-lib
  ✅ Add extraction_mode column migration
  ✅ Re-enable vision extraction in background-enrichment.service.ts
  ✅ Test with small PDF
  ✅ Commit

Session 3 (3 hours):
  ✅ Add presigned upload endpoints (request-upload, upload-complete)
  ✅ Add S3 CORS configuration
  ✅ Install @aws-sdk/s3-presigned-post
  ✅ Update frontend upload flow
  ✅ Remove old direct-upload endpoint (or keep as fallback)
  ✅ Test end-to-end upload flow
  ✅ Commit

Session 4 (2 hours):
  ✅ Integration testing — full pipeline from upload to query
  ✅ Verify all four RAG sources work
  ✅ Test with Ryan's sample documents
  ✅ Performance benchmarks (time each phase)
  ✅ Final commit + deploy
```

**Total: ~10 hours of Kiro implementation across 4 sessions.**
