# Advanced Document Extraction Architecture

## Problem Statement

Extract structured financial data from user-uploaded documents including:
- **Complex tables** (multi-level headers, merged cells, footnotes)
- **Charts & graphs** (bar charts, line graphs, pie charts with data)
- **Inline metrics** (revenue figures in paragraphs, percentages in text)
- **Narratives** (MD&A, risk factors, business descriptions)
- **Footnotes** (accounting policies, assumptions, disclosures)
- **Author/metadata** (document title, date, company, authors)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    DOCUMENT UPLOAD                               │
│                  (PDF/DOCX/TXT/XLSX)                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              MULTI-MODAL EXTRACTION PIPELINE                     │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Text       │  │   Tables     │  │   Images     │         │
│  │  Extraction  │  │  Extraction  │  │  Extraction  │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                  │                  │                  │
│         ▼                  ▼                  ▼                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Narrative   │  │   Tabular    │  │    Chart     │         │
│  │   Chunking   │  │   Parsing    │  │   Analysis   │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                 │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  INTELLIGENT STORAGE                             │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐                    │
│  │  Vector Store    │  │  Structured DB   │                    │
│  │  (Narratives)    │  │  (Metrics/Tables)│                    │
│  └──────────────────┘  └──────────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    HYBRID RAG RETRIEVAL                          │
│                                                                  │
│  • Semantic search for narratives                               │
│  • SQL queries for structured metrics                           │
│  • Multi-modal context assembly                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Extraction Strategy by Content Type

### 1. Text & Narratives (Simple)

**Tools**: `pdf-parse`, `mammoth`, `textract`

```typescript
interface NarrativeExtraction {
  method: 'text-extraction';
  tools: ['pdf-parse', 'mammoth'];
  output: {
    fullText: string;
    chunks: TextChunk[];
    metadata: DocumentMetadata;
  };
}
```

**Process**:
1. Extract raw text with layout preservation
2. Identify sections (headers, paragraphs, lists)
3. Chunk with semantic boundaries (1000 chars, 200 overlap)
4. Generate embeddings for vector search
5. Store in `document_chunks` with vectors

### 2. Tables (Complex) ⭐

**Challenge**: Multi-level headers, merged cells, footnotes, complex layouts

**Solution**: Multi-stage table extraction

#### Stage 1: Table Detection & Extraction

**Tools**: 
- `pdf-lib` + `pdf-parse` for PDF tables
- `mammoth` for DOCX tables
- `xlsx` for Excel files
- **AWS Textract** (optional, for complex PDFs)

```typescript
interface TableExtraction {
  method: 'hybrid-table-extraction';
  stages: [
    'detection',      // Find table boundaries
    'structure',      // Parse rows/columns/cells
    'normalization',  // Handle merged cells, multi-level headers
    'validation'      // Verify data integrity
  ];
}
```

#### Stage 2: Intelligent Table Parsing

```typescript
interface ParsedTable {
  id: string;
  documentId: string;
  pageNumber: number;
  
  // Structure
  headers: string[][];        // Multi-level headers
  rows: TableRow[];
  footnotes: string[];
  
  // Metadata
  tableType: 'financial' | 'operational' | 'other';
  detectedMetrics: string[];  // Revenue, EBITDA, etc.
  
  // Storage formats
  rawHTML: string;            // For display
  structuredJSON: object;     // For querying
  markdown: string;           // For LLM context
}

interface TableRow {
  rowIndex: number;
  cells: TableCell[];
  isHeader: boolean;
  isFootnote: boolean;
}

interface TableCell {
  value: string | number;
  colSpan: number;
  rowSpan: number;
  dataType: 'text' | 'number' | 'currency' | 'percentage';
  formatting: CellFormatting;
}
```

#### Stage 3: Metric Extraction from Tables

```typescript
interface ExtractedMetric {
  id: string;
  documentId: string;
  tableId: string;
  
  // Metric details
  metricName: string;         // "Revenue", "Net Income"
  value: number;
  unit: string;               // "millions", "thousands"
  currency: string;           // "USD"
  period: string;             // "Q4 2023", "FY 2023"
  
  // Context
  rowLabel: string;
  columnLabel: string;
  footnoteRefs: string[];
  
  // Confidence
  extractionMethod: 'table-cell' | 'inline-text' | 'chart-ocr';
  confidence: number;
}
```

**Implementation**:

```typescript
class TableExtractionService {
  
  async extractTables(document: Document): Promise<ParsedTable[]> {
    const tables: ParsedTable[] = [];
    
    if (document.fileType === 'pdf') {
      // Try native PDF table extraction first
      tables.push(...await this.extractPDFTables(document));
      
      // Fallback to AWS Textract for complex tables
      if (this.hasComplexTables(tables)) {
        tables.push(...await this.extractWithTextract(document));
      }
    } else if (document.fileType === 'docx') {
      tables.push(...await this.extractDOCXTables(document));
    } else if (document.fileType === 'xlsx') {
      tables.push(...await this.extractExcelTables(document));
    }
    
    // Normalize and validate
    return tables.map(t => this.normalizeTable(t));
  }
  
  private async extractPDFTables(document: Document): Promise<ParsedTable[]> {
    // Use pdf-parse + custom table detection
    const pdfData = await pdfParse(document.buffer);
    
    // Detect table regions using layout analysis
    const tableRegions = this.detectTableRegions(pdfData);
    
    // Extract each table
    return tableRegions.map(region => {
      const cells = this.extractCells(region);
      const structure = this.inferTableStructure(cells);
      return this.buildParsedTable(structure);
    });
  }
  
  private normalizeTable(table: ParsedTable): ParsedTable {
    // Handle merged cells
    table = this.expandMergedCells(table);
    
    // Normalize multi-level headers
    table.headers = this.flattenHeaders(table.headers);
    
    // Extract footnotes
    table.footnotes = this.extractFootnotes(table);
    
    // Detect metric columns
    table.detectedMetrics = this.detectMetricColumns(table);
    
    return table;
  }
  
  private detectMetricColumns(table: ParsedTable): string[] {
    const metrics: string[] = [];
    
    // Check headers for financial terms
    const financialTerms = [
      'revenue', 'income', 'ebitda', 'margin', 'assets',
      'liabilities', 'equity', 'cash', 'debt', 'earnings'
    ];
    
    table.headers.forEach(headerRow => {
      headerRow.forEach(header => {
        const normalized = header.toLowerCase();
        if (financialTerms.some(term => normalized.includes(term))) {
          metrics.push(header);
        }
      });
    });
    
    return metrics;
  }
}
```

### 3. Charts & Graphs (Advanced) ⭐⭐

**Challenge**: Extract data from visual representations

**Solution**: Multi-modal approach

#### Option A: Claude 3.5 Sonnet Vision (Recommended)

**Why**: Best-in-class vision model, understands financial charts

```typescript
interface ChartExtraction {
  method: 'vision-llm';
  model: 'claude-3.5-sonnet';
  capabilities: [
    'chart-type-detection',
    'data-point-extraction',
    'legend-parsing',
    'axis-label-reading'
  ];
}

class ChartExtractionService {
  
  async extractChartData(
    imageBuffer: Buffer,
    pageContext: string
  ): Promise<ExtractedChartData> {
    
    // Convert image to base64
    const base64Image = imageBuffer.toString('base64');
    
    // Prompt Claude Vision to extract data
    const prompt = `
You are analyzing a financial chart from a due diligence document.

Context from surrounding text:
${pageContext}

Please extract:
1. Chart type (bar, line, pie, etc.)
2. Title and axis labels
3. All data points with exact values
4. Legend items
5. Any footnotes or annotations

Return as structured JSON:
{
  "chartType": "bar" | "line" | "pie" | "scatter",
  "title": "string",
  "xAxis": { "label": "string", "values": [] },
  "yAxis": { "label": "string", "unit": "string" },
  "dataSeries": [
    {
      "name": "string",
      "dataPoints": [{ "x": "value", "y": number }]
    }
  ],
  "footnotes": ["string"]
}
`;
    
    const response = await this.bedrockService.invokeClaudeVision({
      model: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: base64Image
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }],
      max_tokens: 2000
    });
    
    return JSON.parse(response.content[0].text);
  }
}
```

#### Option B: AWS Textract + OCR (Fallback)

For simpler charts or when vision model fails:

```typescript
async extractChartWithTextract(imageBuffer: Buffer): Promise<ChartData> {
  const textract = new TextractClient({});
  
  const response = await textract.send(new AnalyzeDocumentCommand({
    Document: { Bytes: imageBuffer },
    FeatureTypes: ['TABLES', 'FORMS']
  }));
  
  // Parse Textract response to extract chart data
  return this.parseTextractChartData(response);
}
```

### 4. Inline Metrics (NLP-based) ⭐

**Challenge**: Extract metrics from narrative text

**Examples**:
- "Revenue increased 15% to $2.5 billion in Q4 2023"
- "EBITDA margin improved from 18.2% to 21.5%"
- "The company reported net income of $450 million"

**Solution**: Named Entity Recognition + Pattern Matching

```typescript
interface InlineMetricExtraction {
  method: 'nlp-pattern-matching';
  techniques: [
    'regex-patterns',
    'llm-extraction',
    'context-aware-parsing'
  ];
}

class InlineMetricExtractor {
  
  // Regex patterns for common metric formats
  private patterns = {
    currency: /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand)?/gi,
    percentage: /(\d+(?:\.\d+)?)\s*%/g,
    metricWithValue: /(revenue|income|ebitda|margin|earnings|sales|profit)\s+(?:of|was|reached|increased to|decreased to)?\s*\$?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(million|billion|thousand)?/gi
  };
  
  async extractInlineMetrics(text: string): Promise<ExtractedMetric[]> {
    const metrics: ExtractedMetric[] = [];
    
    // Method 1: Regex pattern matching
    metrics.push(...this.extractWithPatterns(text));
    
    // Method 2: LLM-based extraction for complex cases
    metrics.push(...await this.extractWithLLM(text));
    
    // Deduplicate and validate
    return this.deduplicateMetrics(metrics);
  }
  
  private extractWithPatterns(text: string): ExtractedMetric[] {
    const metrics: ExtractedMetric[] = [];
    
    // Extract currency values with context
    let match;
    while ((match = this.patterns.metricWithValue.exec(text)) !== null) {
      const [fullMatch, metricName, value, unit] = match;
      
      metrics.push({
        id: uuid(),
        metricName: this.normalizeMetricName(metricName),
        value: this.parseValue(value, unit),
        unit: unit || 'units',
        context: this.extractContext(text, match.index, 100),
        extractionMethod: 'regex-pattern',
        confidence: 0.85
      });
    }
    
    return metrics;
  }
  
  private async extractWithLLM(text: string): Promise<ExtractedMetric[]> {
    // Use Claude to extract metrics from complex sentences
    const prompt = `
Extract all financial metrics from this text. Return as JSON array:

Text: "${text}"

Format:
[
  {
    "metricName": "Revenue",
    "value": 2500,
    "unit": "millions",
    "currency": "USD",
    "period": "Q4 2023",
    "context": "surrounding sentence"
  }
]
`;
    
    const response = await this.bedrockService.invokeClaude({
      prompt,
      max_tokens: 1000
    });
    
    return JSON.parse(response);
  }
}
```

### 5. Footnotes & References

**Challenge**: Link footnotes to main content

```typescript
interface FootnoteExtraction {
  footnoteId: string;
  marker: string;              // "1", "a", "*"
  content: string;
  linkedTo: {
    tableId?: string;
    paragraphId?: string;
    metricId?: string;
  };
}

class FootnoteExtractor {
  
  async extractFootnotes(document: Document): Promise<FootnoteExtraction[]> {
    const footnotes: FootnoteExtraction[] = [];
    
    // Detect footnote markers in text
    const markers = this.detectFootnoteMarkers(document.text);
    
    // Find corresponding footnote content
    for (const marker of markers) {
      const content = this.findFootnoteContent(document.text, marker);
      const linkedElements = this.findLinkedElements(marker);
      
      footnotes.push({
        footnoteId: uuid(),
        marker: marker.text,
        content,
        linkedTo: linkedElements
      });
    }
    
    return footnotes;
  }
}
```

### 6. Document Metadata & Author Info

```typescript
interface DocumentMetadata {
  // Basic info
  title: string;
  author: string[];
  company: string;
  documentDate: Date;
  documentType: 'pitch-deck' | 'financial-report' | 'analysis' | 'other';
  
  // Financial context
  fiscalPeriod?: string;
  reportingCurrency?: string;
  reportingUnit?: string;
  
  // Extraction metadata
  pageCount: number;
  tableCount: number;
  chartCount: number;
  extractionDate: Date;
}

class MetadataExtractor {
  
  async extractMetadata(document: Document): Promise<DocumentMetadata> {
    // Extract from PDF metadata
    const pdfMeta = await this.extractPDFMetadata(document);
    
    // Extract from first page (title page)
    const titlePageText = await this.extractFirstPage(document);
    const titlePageMeta = await this.parseWithLLM(titlePageText);
    
    // Merge and validate
    return {
      ...pdfMeta,
      ...titlePageMeta,
      pageCount: document.pageCount,
      extractionDate: new Date()
    };
  }
  
  private async parseWithLLM(titlePageText: string): Promise<Partial<DocumentMetadata>> {
    const prompt = `
Extract document metadata from this title page:

${titlePageText}

Return JSON:
{
  "title": "string",
  "author": ["string"],
  "company": "string",
  "documentDate": "YYYY-MM-DD",
  "documentType": "pitch-deck" | "financial-report" | "analysis" | "other",
  "fiscalPeriod": "Q4 2023" (if applicable)
}
`;
    
    const response = await this.bedrockService.invokeClaude({ prompt });
    return JSON.parse(response);
  }
}
```

## Storage Strategy

### Dual Storage Approach

```typescript
// 1. Vector Store (for narratives)
interface VectorChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  chunkType: 'narrative' | 'table-context' | 'chart-context';
  pageNumber: number;
}

// 2. Structured Store (for metrics/tables)
interface StructuredData {
  // Tables
  tables: ParsedTable[];
  
  // Extracted metrics
  metrics: ExtractedMetric[];
  
  // Charts
  charts: ExtractedChartData[];
  
  // Footnotes
  footnotes: FootnoteExtraction[];
}
```

### Database Schema Extension

```prisma
model ExtractedTable {
  id            String   @id @default(uuid())
  documentId    String   @map("document_id")
  tenantId      String   @map("tenant_id")
  
  pageNumber    Int      @map("page_number")
  tableIndex    Int      @map("table_index")
  
  // Structure
  headers       Json     // Multi-level headers
  rows          Json     // All rows
  footnotes     String[]
  
  // Metadata
  tableType     String   @map("table_type")
  detectedMetrics String[] @map("detected_metrics")
  
  // Storage formats
  rawHTML       String   @map("raw_html") @db.Text
  structuredJSON Json    @map("structured_json")
  markdown      String   @db.Text
  
  createdAt     DateTime @default(now()) @map("created_at")
  
  document      Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  metrics       ExtractedMetric[]
  
  @@map("extracted_tables")
  @@index([tenantId, documentId])
}

model ExtractedMetric {
  id            String   @id @default(uuid())
  documentId    String   @map("document_id")
  tenantId      String   @map("tenant_id")
  tableId       String?  @map("table_id")
  
  // Metric details
  metricName    String   @map("metric_name")
  value         Decimal  @db.Decimal(20, 4)
  unit          String
  currency      String?
  period        String?
  
  // Context
  sourceType    String   @map("source_type") // 'table' | 'inline' | 'chart'
  context       String   @db.Text
  pageNumber    Int      @map("page_number")
  
  // Confidence
  extractionMethod String @map("extraction_method")
  confidence    Float
  
  createdAt     DateTime @default(now()) @map("created_at")
  
  document      Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  table         ExtractedTable? @relation(fields: [tableId], references: [id])
  
  @@map("extracted_metrics")
  @@index([tenantId, documentId])
  @@index([metricName])
}

model ExtractedChart {
  id            String   @id @default(uuid())
  documentId    String   @map("document_id")
  tenantId      String   @map("tenant_id")
  
  pageNumber    Int      @map("page_number")
  chartType     String   @map("chart_type")
  title         String?
  
  // Data
  dataSeries    Json     @map("data_series")
  xAxis         Json     @map("x_axis")
  yAxis         Json     @map("y_axis")
  
  // Image
  imageS3Key    String   @map("image_s3_key")
  
  createdAt     DateTime @default(now()) @map("created_at")
  
  document      Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  
  @@map("extracted_charts")
  @@index([tenantId, documentId])
}
```

## Cost Optimization

### Tiered Extraction Strategy

```typescript
interface ExtractionTier {
  tier: 'basic' | 'standard' | 'advanced';
  cost: number;
  capabilities: string[];
}

const EXTRACTION_TIERS: ExtractionTier[] = [
  {
    tier: 'basic',
    cost: 0,
    capabilities: [
      'text-extraction',
      'simple-tables',
      'regex-metrics'
    ]
  },
  {
    tier: 'standard',
    cost: 0.10, // per document
    capabilities: [
      'text-extraction',
      'complex-tables',
      'llm-metrics',
      'metadata-extraction'
    ]
  },
  {
    tier: 'advanced',
    cost: 0.50, // per document
    capabilities: [
      'text-extraction',
      'complex-tables',
      'chart-vision-extraction',
      'llm-metrics',
      'metadata-extraction',
      'footnote-linking'
    ]
  }
];
```

### Smart Extraction Decision

```typescript
class SmartExtractionOrchestrator {
  
  async processDocument(document: Document): Promise<ExtractionResult> {
    // Analyze document complexity
    const complexity = await this.analyzeComplexity(document);
    
    // Choose extraction tier
    const tier = this.selectTier(complexity, document.tenantSettings);
    
    // Execute extraction
    if (tier === 'basic') {
      return this.basicExtraction(document);
    } else if (tier === 'standard') {
      return this.standardExtraction(document);
    } else {
      return this.advancedExtraction(document);
    }
  }
  
  private async analyzeComplexity(document: Document): Promise<ComplexityScore> {
    // Quick scan to detect:
    // - Number of tables
    // - Presence of charts/images
    // - Document length
    // - File type
    
    return {
      tableCount: await this.countTables(document),
      imageCount: await this.countImages(document),
      pageCount: document.pageCount,
      hasComplexTables: await this.detectComplexTables(document),
      recommendedTier: 'standard'
    };
  }
}
```

## Implementation Priority

### Phase 2A: Basic Extraction (Week 1)
- ✅ Text extraction (PDF/DOCX/TXT)
- ✅ Simple table extraction
- ✅ Regex-based inline metrics
- ✅ Basic metadata

### Phase 2B: Advanced Extraction (Week 2)
- ⏳ Complex table parsing
- ⏳ LLM-based metric extraction
- ⏳ Chart extraction with Claude Vision
- ⏳ Footnote linking

### Phase 2C: Optimization (Week 3)
- ⏳ Tiered extraction strategy
- ⏳ Caching and deduplication
- ⏳ Quality validation
- ⏳ User feedback loop

## API Design

```typescript
// Upload with extraction options
POST /api/documents/upload
{
  "file": <multipart>,
  "ticker": "AAPL",
  "extractionTier": "standard",
  "extractOptions": {
    "extractTables": true,
    "extractCharts": true,
    "extractMetrics": true,
    "linkFootnotes": true
  }
}

// Get extracted data
GET /api/documents/:id/extracted-data
Response: {
  "tables": ExtractedTable[],
  "metrics": ExtractedMetric[],
  "charts": ExtractedChart[],
  "metadata": DocumentMetadata
}

// Query metrics
GET /api/documents/:id/metrics?metricName=Revenue
Response: ExtractedMetric[]
```

## Next Steps

1. Implement basic extraction (text + simple tables)
2. Add LLM-based metric extraction
3. Integrate Claude Vision for charts
4. Build structured data storage
5. Create hybrid RAG that queries both vectors and structured data

---

**This architecture provides institutional-grade extraction while maintaining cost efficiency through tiered processing.**
