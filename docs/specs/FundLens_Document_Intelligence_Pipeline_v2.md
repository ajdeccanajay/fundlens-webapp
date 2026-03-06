# FundLens — Document Intelligence Pipeline
## Multi-Modal Extraction, Storage & Universal RAG Specification

| Field | Value |
|-------|-------|
| Version | 2.0 |
| Date | February 26, 2026 |
| Author | Ajay + Claude (Architect) |
| Status | Implementation Spec |
| Priority | P0 — Prerequisite for uploaded document queries |
| Depends On | QUL Specification v1 (implemented), RAG pipeline fixes (implemented) |

### Changelog v2.0
- **DynamoDB → PostgreSQL RDS:** All structured data storage now uses existing PostgreSQL RDS, not DynamoDB. Eliminates dual source of truth.
- **Lessons from RAG pipeline debugging:** Incorporated fixes for synonym-based retrieval, computed metric routing, source-aware degradation, uploaded doc retriever parallelism, synthesis prompt data source labeling, and formatValue output_format awareness.
- **Added Section 15:** Extracted Metrics → Existing Retrieval Integration (how pipeline output feeds the retriever/formula engine we just fixed).
- **Added Section 16:** Lessons Learned — hard rules from debugging the profitability query.

---

# 1. The Problem

FundLens can understand what an analyst is asking (QUL) and can compute metrics deterministically (formula engine). But when an analyst uploads a CIM, a 10-K, or 50 documents from a data room, the system needs to **proactively extract everything** — text, tables, charts, images, structured metrics — and distribute it across the right storage layers so the QUL can find it.

Today, document upload is handled reactively: the analyst asks a question, and the system extracts the answer on-demand from raw document chunks. This is slow (2-5 seconds per question), doesn't pre-populate the deterministic engine, and can't support cross-document search.

The Document Intelligence Pipeline replaces this with a proactive, multi-modal extraction system that runs automatically on upload and makes documents progressively queryable across all retrieval paths.

> **THE 5-SECOND PROMISE:** A document should be queryable within 5 seconds of upload (instant long-context RAG), progressively improve as extraction completes (30-60 seconds), and be permanently indexed for cross-document RAG (5-15 minutes). The analyst should never wait.

---

# 2. Three-Tier Availability Model

```
Upload (analyst drops a file into research.html)
  │
  ▼ (< 5 seconds)
┌─────────────────────────────────────────────────────────────┐
│  TIER 1: INSTANT RAG                                        │
│  How: Raw document sent to Sonnet/Opus via long context      │
│       window (200K tokens). No indexing needed.               │
│  What works: Single-doc Q&A, intake summary, first questions │
│  What doesn't: Cross-doc search, deterministic metrics,      │
│                corpus-wide retrieval                          │
│  Cost: ~$0.01-0.05 per query (full doc in context)          │
└─────────────────────────────────┬───────────────────────────┘
                                  │
  ▼ (30-60 seconds, background)
┌─────────────────────────────────────────────────────────────┐
│  TIER 2: EXTRACTED + EPHEMERAL VECTOR STORE                  │
│  How: Multi-modal extraction pipeline runs in background.     │
│       Pages → vision extraction → structured metrics →        │
│       financial-aware chunks → embeddings → OpenSearch.        │
│  What works: RAG with citations, metric lookups from cache,  │
│              chart/table queries, formula engine integration   │
│  What doesn't: Cross-session search, other analysts' queries │
│  Cost: ~$0.02-0.10 per page (one-time extraction)           │
└─────────────────────────────────┬───────────────────────────┘
                                  │
  ▼ (5-15 minutes, async cron)
┌─────────────────────────────────────────────────────────────┐
│  TIER 3: PERSISTENT RAG                                      │
│  How: Chunks written to S3 → Bedrock KB ingestion job.        │
│       Structured metrics persisted to PostgreSQL RDS.          │
│  What works: Everything. Cross-doc search, cross-session,    │
│              cross-analyst (within tenant), corpus-wide RAG    │
│  Cost: Bedrock KB hosting + storage (minimal per-query)      │
└─────────────────────────────────────────────────────────────┘
```

The orchestrator (built in the QUL spec) checks document status and routes to the best available tier automatically. The analyst never needs to know which tier is serving their query.

---

# 3. Document Processing Pipeline

## 3.1 End-to-End Flow

```
Document Upload
    │
    ▼
STEP 0: REGISTER
    ├── Store raw file in S3: s3://{bucket}/raw/{tenantId}/{workspaceId}/{docId}/{filename}
    ├── Create record in PostgreSQL `documents` table
    ├── Return documentId to frontend immediately
    ├── Frontend shows "Ready for questions" (Tier 1 active)
    └── Trigger extraction pipeline (async)
    │
    ▼
STEP 1: CLASSIFY (< 5 seconds)
    ├── Detect file type: PDF, DOCX, XLSX, PPTX, TXT, image
    ├── For PDFs: Extract text layer (pdftotext) + convert to page images (pdftoppm)
    ├── For XLSX: Programmatic extraction via SheetJS (NOT image conversion)
    ├── For DOCX/PPTX: Convert via LibreOffice → page images
    ├── First-pass classification from filename + first page:
    │     SEC filing (10-K, 10-Q, 8-K, DEF 14A)
    │     Earnings transcript
    │     CIM / Information Memorandum
    │     Management presentation
    │     Financial model (Excel)
    │     Due diligence report
    │     Data room miscellaneous
    └── Update PostgreSQL documents table: document_type, page_count, classification_confidence
    │
    ▼
STEP 2: EXTRACT (30-60 seconds, parallel)
    ├── Route by document type:
    │     PDF/DOCX/PPTX → Page Vision Extraction (Section 4)
    │     XLSX → Excel Programmatic Extraction (Section 5)
    │     Earnings transcript (text) → Earnings Call Extraction (Section 6)
    │
    ├── Each extractor produces:
    │     structured_metrics[]   → PostgreSQL extracted_metrics table
    │     text_content[]         → chunking pipeline
    │     tables[]               → dual storage (metrics to RDS + markdown chunks to vector store)
    │     charts[]               → dual storage (data points to RDS + description chunks to vector store)
    │     forward_looking[]      → tagged chunks
    │     notable_items[]        → flagged for provocation engine
    │
    └── Update PostgreSQL documents table: processing_status = "extracted"
    │
    ▼
STEP 3: CHUNK + EMBED (10-20 seconds)
    ├── Financial-aware chunking (Section 7)
    ├── Generate embeddings (Amazon Titan Embed V2, 1024 dim)
    │     MUST match Bedrock KB embedding model for consistency
    ├── Index in ephemeral OpenSearch: index-{tenantId}-{workspaceId}
    ├── Update PostgreSQL documents table: ephemeral_rag_status = "ready"
    └── Tier 2 is now active — analyst gets RAG-quality answers
    │
    ▼
STEP 4: GENERATE INTAKE SUMMARY (5-10 seconds, parallel with Step 3)
    ├── Sonnet processes classification + headline metrics
    ├── Produces natural language intake summary
    ├── Cached in session + PostgreSQL documents table (intake_summary column)
    └── Served as first response: "I've processed [Company]'s CIM. Here's what I found..."
    │
    ▼
STEP 5: QUEUE FOR KB SYNC (async, cron picks up every 15 min)
    ├── Write chunks to S3: s3://{bucket}/kb-ready/{tenantId}/{workspaceId}/{docId}/
    ├── Format with Bedrock KB metadata schema
    ├── Cron Lambda triggers StartIngestionJob
    ├── Persist structured metrics to RDS financial_metrics table (using canonical normalized_metric names)
    ├── Update PostgreSQL documents table: kb_sync_status = "indexed"
    └── Tier 3 is now active — cross-document search works
```

## 3.2 Service Architecture

```typescript
// New file: src/ingestion/document-intelligence.service.ts

@Injectable()
export class DocumentIntelligenceService {

  constructor(
    private readonly pageExtractor: PageVisionExtractorService,
    private readonly excelExtractor: ExcelExtractorService,
    private readonly earningsExtractor: EarningsCallExtractorService,
    private readonly chunker: FinancialChunkingService,
    private readonly embedder: EmbeddingService,
    private readonly openSearch: OpenSearchService,
    private readonly metricsStore: DealMetricsService,
    private readonly documentRegistry: DocumentRegistryService,
    private readonly kbSyncQueue: KBSyncQueueService,
  ) {}

  async processUpload(
    file: UploadedFile,
    tenantId: string,
    workspaceId: string,
    dealId?: string,
  ): Promise<ProcessingResult> {

    // STEP 0: Register
    const doc = await this.documentRegistry.register(file, tenantId, workspaceId, dealId);

    // STEP 1: Classify + prepare
    const prepared = await this.classifyAndPrepare(file, doc);

    // STEP 2: Extract (route by type)
    let extractions: ExtractionResult;
    switch (prepared.documentType) {
      case 'excel_financial_model':
        extractions = await this.excelExtractor.extract(file, doc);
        break;
      case 'earnings_transcript':
        extractions = await this.earningsExtractor.extract(file, doc);
        break;
      default:
        // PDF, DOCX, PPTX, images → page vision extraction
        extractions = await this.pageExtractor.extractAllPages(prepared.pages, doc);
    }

    // STEP 3: Store structured metrics + chunk + embed (parallel)
    const [metricsResult, chunkResult, intakeSummary] = await Promise.all([
      this.metricsStore.storeExtractedMetrics(extractions.metrics, doc, tenantId),
      this.chunkAndEmbed(extractions, doc, tenantId, workspaceId),
      this.generateIntakeSummary(extractions, doc),
    ]);

    // STEP 4: Queue for persistent KB sync
    await this.kbSyncQueue.enqueue(doc, tenantId, workspaceId);

    // Update status
    await this.documentRegistry.updateStatus(doc.id, 'extracted');

    return {
      documentId: doc.id,
      documentType: prepared.documentType,
      pageCount: prepared.pageCount,
      metricsExtracted: metricsResult.count,
      chunksCreated: chunkResult.count,
      intakeSummary,
      tier: 'tier2_extracted',
    };
  }

  private async chunkAndEmbed(
    extractions: ExtractionResult,
    doc: DocumentRecord,
    tenantId: string,
    workspaceId: string,
  ): Promise<ChunkResult> {
    // Financial-aware chunking
    const chunks = this.chunker.chunk(extractions, doc);

    // Generate embeddings (batch)
    const embedded = await this.embedder.batchEmbed(chunks);

    // Index in ephemeral OpenSearch
    const indexName = `idx-${tenantId}-${workspaceId}`;
    await this.openSearch.bulkIndex(indexName, embedded);

    return { count: embedded.length, indexName };
  }
}
```

---

# 4. Page Vision Extraction (PDFs, DOCX, PPTX, Images)

## 4.1 Process

Each page is converted to an image and sent to Sonnet with vision. Pages are processed in parallel (batch of 10 to avoid throttling) for a typical 100-page 10-K, total extraction time is 30-60 seconds.

```typescript
// New file: src/ingestion/page-vision-extractor.service.ts

async extractAllPages(
  pages: PageImage[],
  doc: DocumentRecord,
): Promise<ExtractionResult> {

  const batchSize = 10;
  const allExtractions: PageExtraction[] = [];

  for (let i = 0; i < pages.length; i += batchSize) {
    const batch = pages.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((page, idx) => this.extractSinglePage(page, i + idx, doc))
    );
    allExtractions.push(...results);
  }

  // Assemble cross-page structures (tables spanning pages, continued sections)
  const assembled = this.assemblePageExtractions(allExtractions);

  return assembled;
}
```

## 4.2 Page Vision Extraction Prompt

**Model:** Claude Sonnet 4.5 (vision), temperature 0.0

```
You are a financial document extraction specialist for FundLens. Process this
single page and extract ALL information as structured JSON.

CONTEXT:
Document: {{document_name}}
Document Type: {{document_type}}
Company: {{company_name}} ({{ticker}})
Filing Period: {{filing_period}}
Page: {{page_number}} of {{total_pages}}

OUTPUT FORMAT (JSON only, no markdown, no preamble):
{
  "page_type": "<cover | table_of_contents | income_statement | balance_sheet
    | cash_flow | equity_statement | md_and_a | risk_factors |
    notes_to_financials | executive_compensation | segment_data |
    earnings_summary | guidance | chart_page | appendix | other>",

  "section_heading": "<section this page belongs to>",

  "text_content": "<all readable text, preserving paragraph structure>",

  "tables": [
    {
      "table_id": "<unique within document: tbl_{page}_{index}>",
      "table_title": "<title or caption>",
      "table_type": "<financial_statement | data_table | comparison |
        schedule | segment_breakdown | footnote_table>",
      "headers": ["<col1>", "<col2>", "..."],
      "rows": [
        {
          "label": "<row label>",
          "values": ["<val1>", "<val2>", "..."],
          "is_subtotal": <true|false>,
          "is_total": <true|false>,
          "indent_level": <0|1|2>
        }
      ],
      "currency": "<USD | EUR | GBP | etc>",
      "unit_scale": "<units | thousands | millions | billions>",
      "periods_covered": ["<col1 period>", "<col2 period>"],
      "footnotes": ["<any footnotes referenced in this table>"],
      "continues_from_previous_page": <true|false>,
      "continues_on_next_page": <true|false>
    }
  ],

  "charts": [
    {
      "chart_id": "<unique: chart_{page}_{index}>",
      "chart_type": "<bar | line | pie | waterfall | stacked_bar |
        scatter | area | combo | other>",
      "title": "<chart title if visible>",
      "description": "<detailed description of what the chart shows>",
      "x_axis": "<label and units>",
      "y_axis": "<label and units>",
      "data_points": [
        {
          "label": "<category or date>",
          "value": <number>,
          "series": "<series name if multi-series>",
          "unit": "<$M | % | count | etc>"
        }
      ],
      "trend": "<increasing | decreasing | stable | mixed | cyclical>",
      "insight": "<key takeaway from this chart>"
    }
  ],

  "structured_metrics": [
    {
      "metric_name": "<as stated in document>",
      "canonical_hint": "<closest canonical metric name from FundLens registry>",
      "value": <number>,
      "unit": "<USD | EUR | % | ratio | bps | count>",
      "period": "<FY2024 | Q3 2025 | LTM Sep 2025 | YTD>",
      "period_end_date": "<YYYY-MM-DD if determinable>",
      "context": "<GAAP | non-GAAP | adjusted | pro-forma | management |
        as-reported | restated>",
      "yoy_change": <number or null>,
      "yoy_change_pct": <number or null>,
      "source_table_id": "<tbl_X_Y reference>",
      "line_item_hierarchy": "<parent > child, e.g., Revenue > Product Revenue>"
    }
  ],

  "visual_elements": [
    {
      "type": "<logo | photo | diagram | org_chart | process_flow |
        infographic | map | signature | watermark>",
      "description": "<what it depicts>",
      "extracted_data": "<any text or data visible in the visual>"
    }
  ],

  "forward_looking_statements": [
    {
      "statement": "<the forward-looking language>",
      "category": "<guidance | projection | expectation | target | outlook>",
      "metric_referenced": "<which metric, if any>",
      "time_horizon": "<next quarter | FY | multi-year | unspecified>"
    }
  ],

  "notable_items": [
    {
      "item": "<description>",
      "severity": "<info | watch | flag>",
      "category": "<restatement | material_weakness | going_concern |
        related_party | litigation | accounting_change | impairment |
        unusual_item | auditor_qualification>"
    }
  ],

  "cross_references": [
    "<references to other sections, exhibits, or notes, e.g.,
     'See Note 12 for segment details'>"
  ]
}

EXTRACTION RULES:
1. TABLES: Extract EVERY row and column. Do NOT summarize or truncate.
   Financial accuracy is paramount — a single wrong number destroys trust.
2. CHARTS: Describe what you SEE, not what you infer. Read axis labels
   and extract all visible data points with their exact values.
3. METRICS: Standardize names where obvious. "Net revenues", "Total net
   revenue", "Revenue, net" → metric_name: "Total Revenue". Preserve
   original phrasing in context.
4. PERIODS: Always include time period. If comparative data shown
   (current vs prior year), extract metrics for ALL periods.
5. TABLES SPANNING PAGES: If a table is clearly continued from the
   previous page, set continues_from_previous_page: true. The assembler
   will merge them.
6. UNIT SCALE: Pay close attention to "(in millions)" or "(in thousands)"
   headers. Set unit_scale accordingly. A $1,234 in a "millions" table
   is $1.234B, not $1,234.
7. If a page has no meaningful content (blank, decorative, legal
   boilerplate), return minimal JSON with page_type "other".
```

## 4.3 Post-Extraction Assembly

After all pages are extracted individually, the assembler merges cross-page structures:

```typescript
// In page-vision-extractor.service.ts

private assemblePageExtractions(pages: PageExtraction[]): ExtractionResult {
  const assembled: ExtractionResult = {
    metrics: [],
    tables: [],
    charts: [],
    textChunks: [],
    forwardLooking: [],
    notableItems: [],
  };

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    // Merge tables that span pages
    for (const table of page.tables) {
      if (table.continues_from_previous_page && assembled.tables.length > 0) {
        const prevTable = assembled.tables[assembled.tables.length - 1];
        if (prevTable.continues_on_next_page) {
          // Append rows to previous table (skip duplicate header row)
          prevTable.rows.push(...table.rows);
          prevTable.continues_on_next_page = table.continues_on_next_page;
          prevTable.pageNumbers.push(i + 1);
          continue;
        }
      }
      assembled.tables.push({
        ...table,
        pageNumbers: [i + 1],
      });
    }

    // Collect all metrics with page references
    for (const metric of page.structured_metrics) {
      assembled.metrics.push({
        ...metric,
        pageNumber: i + 1,
        documentSection: page.section_heading,
      });
    }

    // Collect text content with section tracking
    if (page.text_content?.trim()) {
      assembled.textChunks.push({
        content: page.text_content,
        pageNumber: i + 1,
        sectionType: page.page_type,
        sectionHeading: page.section_heading,
      });
    }

    // Charts, forward-looking, notable items — collect with page refs
    assembled.charts.push(...page.charts.map(c => ({ ...c, pageNumber: i + 1 })));
    assembled.forwardLooking.push(...page.forward_looking_statements.map(
      f => ({ ...f, pageNumber: i + 1 })));
    assembled.notableItems.push(...page.notable_items.map(
      n => ({ ...n, pageNumber: i + 1 })));
  }

  return assembled;
}
```

---

# 5. Excel / Financial Model Extraction

Excel files are the one document type that should NOT be processed via page vision. Converting to images destroys formulas, cell references, named ranges, and sheet structure — which are the most valuable parts of a financial model.

## 5.1 Programmatic Extraction

```typescript
// New file: src/ingestion/excel-extractor.service.ts

@Injectable()
export class ExcelExtractorService {

  async extract(
    file: UploadedFile,
    doc: DocumentRecord,
  ): Promise<ExtractionResult> {

    // Parse workbook programmatically (SheetJS / openpyxl via Python bridge)
    const workbook = await this.parseWorkbook(file);

    const result: ExtractionResult = {
      metrics: [],
      tables: [],
      charts: [],
      textChunks: [],
      forwardLooking: [],
      notableItems: [],
    };

    for (const sheet of workbook.sheets) {
      // Classify sheet purpose
      const sheetType = this.classifySheet(sheet);
      // Types: assumptions, income_statement, balance_sheet, cash_flow,
      //        dcf, lbo_returns, comps, sensitivity, cap_table, summary

      // Extract structured data based on sheet type
      switch (sheetType) {
        case 'income_statement':
        case 'balance_sheet':
        case 'cash_flow':
          // Extract as financial statement table + metrics
          const { table, metrics } = this.extractFinancialStatement(sheet);
          result.tables.push(table);
          result.metrics.push(...metrics);
          break;

        case 'assumptions':
          // Extract key assumptions as metrics with "assumption" context
          const assumptions = this.extractAssumptions(sheet);
          result.metrics.push(...assumptions.map(a => ({
            ...a,
            context: 'model_assumption',
          })));
          break;

        case 'dcf':
        case 'lbo_returns':
          // Extract valuation outputs + discount rates + terminal values
          const valuation = this.extractValuationSheet(sheet);
          result.metrics.push(...valuation.metrics);
          result.tables.push(valuation.table);
          break;

        case 'sensitivity':
          // Extract sensitivity table as-is (2D matrix)
          result.tables.push(this.extractSensitivityTable(sheet));
          break;

        case 'comps':
          // Extract comparable company data
          const comps = this.extractCompsTable(sheet);
          result.tables.push(comps.table);
          result.metrics.push(...comps.metrics);
          break;

        default:
          // Generic extraction — get all non-empty cells as text
          result.textChunks.push({
            content: this.sheetToMarkdown(sheet),
            sectionType: 'financial_model',
            sectionHeading: sheet.name,
          });
      }
    }

    // Extract formula relationships (for transparency)
    result.formulaGraph = this.extractFormulaGraph(workbook);

    return result;
  }

  private extractFinancialStatement(sheet: Sheet): {
    table: ExtractedTable;
    metrics: ExtractedMetric[];
  } {
    // 1. Find header row (period labels: FY2022, FY2023, FY2024E, etc.)
    const headerRow = this.findHeaderRow(sheet);
    const periods = this.parsePeriodLabels(headerRow);

    // 2. Extract each row with its label and values
    const rows = this.extractDataRows(sheet, headerRow);

    // 3. Map row labels to MetricRegistry canonical hints
    const metrics: ExtractedMetric[] = [];
    for (const row of rows) {
      for (let i = 0; i < periods.length; i++) {
        if (row.values[i] !== null && row.values[i] !== undefined) {
          metrics.push({
            metric_name: row.label,
            canonical_hint: this.guessCanonicalId(row.label),
            value: row.values[i],
            period: periods[i],
            context: periods[i].includes('E') ? 'projected' : 'historical',
            source_sheet: sheet.name,
            source_cell: `${this.colLetter(i + 1)}${row.rowNumber}`,
            has_formula: row.formulas[i] !== null,
            formula_text: row.formulas[i],
          });
        }
      }
    }

    return {
      table: {
        table_id: `excel_${sheet.name}`,
        table_type: 'financial_statement',
        headers: ['Line Item', ...periods],
        rows: rows.map(r => ({
          label: r.label,
          values: r.values.map(v => v?.toString() ?? ''),
          indent_level: r.indentLevel,
          is_total: r.isBold || r.label.toLowerCase().includes('total'),
        })),
        source: 'excel_model',
      },
      metrics,
    };
  }
}
```

## 5.2 Why This Matters

A PE analyst uploads a financial model with 15 sheets. With vision extraction, you get fuzzy readings of numbers and lose all formulas. With programmatic extraction, you get:

- Exact cell values with full precision
- Formula relationships ("EBITDA = Revenue - COGS - OpEx" is in the cell formula)
- Projected vs. historical periods (cells with formulas are projections, hardcoded values are historical)
- Sensitivity tables as proper 2D matrices
- DCF outputs with identifiable discount rates and terminal values
- The ability to feed these directly into the formula engine for validation

---

# 6. Earnings Call Transcript Extraction

Earnings call transcripts are text documents with a unique structure (prepared remarks → Q&A) that requires specialized extraction, not page vision.

## 6.1 Process

```typescript
// New file: src/ingestion/earnings-call-extractor.service.ts

async extract(
  file: UploadedFile,
  doc: DocumentRecord,
): Promise<ExtractionResult> {

  const rawText = await this.readTranscript(file);

  // Single Sonnet call with full transcript (typically 15-40K tokens)
  const structured = await this.bedrockClient.invoke({
    modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    system: EARNINGS_CALL_EXTRACTION_PROMPT,
    messages: [{
      role: 'user',
      content: `Process this earnings call transcript:\n\n` +
        `Company: ${doc.companyName}\n` +
        `Ticker: ${doc.ticker}\n` +
        `Quarter: ${doc.filingPeriod}\n\n` +
        rawText,
    }],
    temperature: 0.0,
    maxTokens: 8192,
  });

  const parsed = JSON.parse(structured);

  // Convert to standard ExtractionResult format
  return this.toExtractionResult(parsed, doc);
}
```

## 6.2 Earnings Call Extraction Prompt

**Model:** Claude Sonnet 4.5 (text), temperature 0.0

```
You are a financial analyst AI processing earnings call transcripts for
FundLens. Transform this raw transcript into structured data that powers
downstream summarization, metric extraction, and provocation generation.

OUTPUT FORMAT (JSON only, no markdown):
{
  "call_metadata": {
    "company": "<company name>",
    "ticker": "<ticker>",
    "quarter": "<e.g., Q3 2025>",
    "date": "<call date>",
    "participants": {
      "management": [
        { "name": "<name>", "title": "<title>" }
      ],
      "analysts": [
        { "name": "<name>", "firm": "<firm>" }
      ]
    }
  },

  "prepared_remarks": [
    {
      "speaker": "<name>",
      "role": "<CEO | CFO | COO | VP | IR | other>",
      "topics_covered": ["<topic1>", "<topic2>"],
      "key_statements": [
        {
          "statement": "<exact or near-exact quote>",
          "category": "<financial_results | guidance | strategy |
            operational_update | market_commentary | product_update |
            capital_allocation | m_and_a | headcount | regulatory>",
          "sentiment": "<positive | negative | neutral |
            cautiously_optimistic | defensive | evasive>",
          "metrics_mentioned": [
            {
              "metric": "<name>",
              "value": "<value>",
              "comparison": "<vs prior period/guidance>"
            }
          ],
          "forward_looking": true|false
        }
      ],
      "notable_language": [
        "<unusual phrases, hedging, tone shifts worth flagging>"
      ]
    }
  ],

  "qa_exchanges": [
    {
      "analyst_name": "<name>",
      "analyst_firm": "<firm>",
      "question_topic": "<brief topic>",
      "question_text": "<the question>",
      "question_sharpness": "<routine | probing | confrontational>",
      "responder": "<who answered>",
      "response_summary": "<2-3 sentence summary>",
      "response_directness": "<direct | partial | evasive |
        defensive | deflective>",
      "was_question_fully_answered": true|false,
      "metrics_discussed": [
        { "metric": "<name>", "value": "<value if given>" }
      ],
      "notable_moments": "<tension, non-answers, redirections,
        surprising disclosures>"
    }
  ],

  "guidance_summary": {
    "guidance_changed": true|false,
    "direction": "<raised | lowered | maintained | narrowed | withdrew>",
    "items": [
      {
        "metric": "<e.g., Revenue, EPS, Operating Margin>",
        "current_guidance": "<value or range>",
        "prior_guidance": "<if mentioned>",
        "change_description": "<what changed>"
      }
    ],
    "qualitative_outlook": "<management's overall characterization>"
  },

  "tone_analysis": {
    "overall_confidence": <1-10>,
    "confidence_rationale": "<why this score>",
    "hedging_instances": ["<specific hedging phrases>"],
    "superlatives_used": ["<'best quarter ever', 'record', etc.>"],
    "topics_avoided": ["<topics that came up but weren't addressed>"],
    "new_terminology": ["<new buzzwords or framing not used before>"]
  },

  "red_flags": [
    {
      "flag": "<description>",
      "evidence": "<what was said or not said>",
      "severity": "<low | medium | high>"
    }
  ],

  "topics_not_discussed": [
    "<important topics conspicuously absent>"
  ],

  "all_metrics_mentioned": [
    {
      "metric_name": "<standardized name>",
      "canonical_hint": "<FundLens canonical metric>",
      "value": <number>,
      "unit": "<USD | % | etc>",
      "period": "<quarter/year>",
      "context": "<as-reported | guidance | comparison>",
      "speaker": "<who stated it>"
    }
  ]
}

EXTRACTION RULES:
1. SPEAKER ATTRIBUTION MATTERS. If the CEO says something optimistic but
   the CFO hedges, capture both. Executive disagreement is a signal.
2. TRACK WHAT'S NOT SAID. If a company previously discussed a product
   line and it's absent, flag it in topics_not_discussed.
3. HEDGING LANGUAGE. Flag: "subject to", "we believe", "we expect",
   "cautiously", "in the current environment", "going forward",
   "we'll see", "it's early days", "we're monitoring".
4. EVASION DETECTION. If analyst asks X and management pivots to Y,
   mark was_question_fully_answered: false.
5. GUIDANCE IS SACRED. Extract exact numbers, ranges, qualifiers.
   If guidance is reiterated vs changed, note explicitly.
6. SENTIMENT SCORING — BE CONSERVATIVE. 7/10 confidence means
   notably confident, not just "things are fine."
```

---

# 7. Financial-Aware Chunking

Standard token-based chunking destroys financial documents. The chunking strategy must be section-aware and table-preserving.

## 7.1 Chunk Schema

```typescript
interface FinancialChunk {
  chunkId: string;                    // uuid
  documentId: string;
  content: string;                    // Text or markdown
  contentType: 'text' | 'table' | 'chart_description' |
    'qa_exchange' | 'guidance' | 'mixed';
  embedding: number[];                // 1024-dim Titan vector

  metadata: {
    // Tenant isolation (REQUIRED on every chunk)
    tenantId: string;
    workspaceId: string;

    // Document context
    documentId: string;
    documentType: string;             // '10-K', 'CIM', 'earnings_transcript'
    documentClass: 'sec_filing' | 'pe_deal_doc' | 'user_upload' |
      'earnings_transcript' | 'financial_model';
    reportingEntity: string;          // Company name
    ticker?: string;

    // Section context
    filingPeriod: string;             // 'FY2024', 'Q3 2025', 'LTM Sep 2025'
    sectionType: string;              // 'income_statement', 'md_and_a', etc.
    sectionHeading: string;           // Full section heading
    pageNumbers: number[];

    // Content flags (for filtered retrieval)
    hasQuantitativeData: boolean;
    hasForwardLooking: boolean;
    hasTable: boolean;
    hasChart: boolean;
    metricsReferenced: string[];      // ['revenue', 'ebitda_margin']

    // Earnings call specific
    speakerName?: string;
    speakerRole?: string;
    isQA?: boolean;
  };
}
```

## 7.2 Chunking Rules

1. **Never split a table.** If a table exceeds target chunk size, split by logical row groups (revenue section, expense section) with the header row duplicated in each sub-chunk.

2. **Never split a financial statement.** Income statement, balance sheet, cash flow statement are each one chunk (or logical sub-chunks with headers preserved).

3. **Section boundaries are chunk boundaries.** MD&A section 1 (overview) and section 2 (results of operations) are separate chunks even if short.

4. **Charts become two chunks:** one text chunk with the visual description and insight (for semantic search), one structured chunk with extracted data points (for metric queries).

5. **Earnings call Q&A:** Each analyst question + management response is one atomic chunk. Never split a Q&A exchange.

6. **Earnings call prepared remarks:** Split by speaker and topic. Each speaker's remarks on one topic = one chunk.

7. **Target chunk size: 500-1000 tokens.** Section/table integrity takes priority over size targets.

8. **Overlap: 50 tokens** at text section boundaries for context continuity. Zero overlap within tables and Q&A exchanges.

9. **Forward-looking statements:** Always tagged with `hasForwardLooking: true` and the relevant metric, so the QUL can filter for guidance queries.

10. **Cross-references:** If a chunk references another section ("See Note 12"), include the cross-reference text but don't attempt to resolve it at chunking time. The RAG retriever can pull Note 12 as a separate result.

---

# 8. Data Distribution: Where Everything Gets Stored

Every extracted data type has a specific storage destination and a specific QUL retrieval path that finds it.

```
┌──────────────────────┬───────────────────────────────────┬───────────────────┐
│ Data Type            │ Storage                           │ QUL Retrieval Path│
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Structured metrics   │ PostgreSQL: extracted_metrics      │ structured_db     │
│ (from tables,        │ table (uses SAME normalized_metric │                   │
│ financial stmts,     │ canonical IDs as SEC filing data   │                   │
│ uploaded docs)       │ so existing retriever works)       │                   │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Text chunks          │ Tier 2: OpenSearch (ephemeral)    │ uploaded_doc_rag  │
│ (MD&A, risks, notes) │ Tier 3: Bedrock KB (persistent)   │ semantic_kb       │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Table content        │ DUAL: metrics → PostgreSQL         │ structured_db +   │
│ (full tables)        │       markdown → vector store     │ uploaded_doc_rag  │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Chart data           │ DUAL: data points → PostgreSQL     │ structured_db +   │
│ (extracted charts)   │       description → vector store  │ semantic_kb       │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Q&A exchanges        │ Vector store (atomic chunks)      │ earnings_transcript│
│ (earnings calls)     │ Speaker metadata in chunk metadata│                   │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Guidance/projections │ Tagged chunks in vector store     │ semantic_kb       │
│                      │ (hasForwardLooking = true)        │ (metadata filter) │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Tone/sentiment       │ PostgreSQL: call_analysis table    │ earnings_transcript│
│ (earnings call)      │ (per-call, not per-chunk)         │                   │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Red flags /          │ PostgreSQL: document_flags table   │ Provocation engine│
│ notable items        │ (severity-tagged, reviewable)     │                   │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Excel formulas       │ PostgreSQL: model_formulas table   │ formula_engine    │
│ (formula graph)      │ (cell refs, dependencies)         │                   │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Document metadata    │ PostgreSQL: documents table        │ QUL context       │
│ (classification,     │ (populates uploaded_documents      │ (Haiku input)     │
│ status, tier)        │  in QUL Haiku message)            │                   │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Intake summary       │ Session cache + PostgreSQL         │ Served on first   │
│                      │ documents.intake_summary column    │ interaction       │
├──────────────────────┼───────────────────────────────────┼───────────────────┤
│ Raw document         │ S3: raw/{tenantId}/...            │ instant_long_     │
│                      │                                   │ context (Tier 1)  │
└──────────────────────┴───────────────────────────────────┴───────────────────┘
```

### CRITICAL: Extracted Metrics Must Use Canonical normalized_metric Values

This is the single most important rule in the entire pipeline. When the extraction prompt returns `metric_name: "Total Revenue"` with `canonical_hint: "revenue"`, the value stored in PostgreSQL `extracted_metrics.normalized_metric` MUST be the MetricRegistry canonical ID — not the raw document label.

Why: The structured retriever queries `WHERE normalized_metric IN (synonyms)` using the MetricRegistry's synonym index. If extracted metrics use canonical IDs, they're immediately findable. If they use raw document labels, you recreate the exact synonym gap bug we spent days debugging.

```typescript
// In storeExtractedMetrics():
for (const metric of extractedMetrics) {
  // Resolve canonical ID using MetricRegistry
  const resolution = this.metricRegistry.resolve(metric.canonical_hint);
  
  const canonicalId = resolution?.canonical_id ?? metric.canonical_hint;
  const outputFormat = resolution?.output_format ?? 'number';
  
  await this.prisma.extractedMetric.create({
    data: {
      tenantId,
      documentId: doc.id,
      ticker: doc.ticker,
      normalizedMetric: canonicalId,     // CANONICAL, not raw
      rawLabel: metric.metric_name,       // Preserve original for audit
      value: metric.value,
      unit: metric.unit,
      period: metric.period,
      periodEndDate: metric.period_end_date,
      context: metric.context,            // GAAP, non-GAAP, adjusted, etc.
      outputFormat,                        // percentage, ratio, currency, count
      sourceDocumentId: doc.id,
      sourcePageNumber: metric.pageNumber,
      sourceTableId: metric.source_table_id,
      extractionConfidence: metric.extraction_confidence ?? 'high',
      createdAt: new Date(),
    },
  });
}
```

---

# 9. Multi-Tenant Storage Isolation

Every storage layer enforces tenant isolation. This is non-negotiable for Tristone-style deployments where one firm's analysts handle competing clients.

## 9.1 S3

```
s3://fundlens-{env}/
├── raw/{tenantId}/{workspaceId}/{docId}/{filename}
├── extracted/{tenantId}/{workspaceId}/{docId}/
│   ├── pages/page_001.json ... page_N.json
│   ├── classification.json
│   ├── intake_summary.json
│   └── excel/  (for financial models)
│       ├── sheets.json
│       └── formula_graph.json
├── kb-ready/{tenantId}/{workspaceId}/{docId}/
│   ├── chunk_001.json ... chunk_N.json
│   └── chunk_metadata.json
└── metrics/{tenantId}/{workspaceId}/{docId}/
    └── structured_metrics.json
```

## 9.2 Bedrock KB

Recommended: **Separate data source per tenant within a shared KB.** This gives isolation at ingestion while sharing infrastructure. Each data source points to `s3://fundlens-{env}/kb-ready/{tenantId}/`.

At query time, always filter by tenantId in metadata, even with data source isolation — defense in depth.

## 9.3 OpenSearch (Ephemeral Tier 2)

- Index per tenant + workspace: `idx-{tenantId}-{workspaceId}`
- TTL: 24 hours after last access
- Cleanup cron runs hourly, evicts expired indexes
- Recreated on demand if analyst returns to the workspace

## 9.4 PostgreSQL RDS

All tables enforce tenant isolation via `tenant_id` column with row-level security or application-layer filtering.

```sql
-- Document registry (tracks upload status and processing tier)
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  workspace_id VARCHAR(64) NOT NULL,
  deal_id VARCHAR(64),
  file_name VARCHAR(512) NOT NULL,
  file_type VARCHAR(32) NOT NULL,         -- pdf, docx, xlsx, pptx, txt, image
  document_type VARCHAR(64),              -- 10-K, CIM, earnings_transcript, etc.
  reporting_entity VARCHAR(256),          -- Company name detected from content
  ticker VARCHAR(16),                     -- Resolved ticker, if applicable
  filing_period VARCHAR(32),              -- FY2024, Q3 2025, etc.
  page_count INTEGER,
  classification_confidence VARCHAR(16),  -- high, medium, low
  
  -- Processing status tracking
  processing_status VARCHAR(32) NOT NULL DEFAULT 'registered',
    -- registered → classifying → extracting → extracted → indexed → failed
  ephemeral_rag_status VARCHAR(32) DEFAULT 'pending',
    -- pending → indexing → ready → expired
  kb_sync_status VARCHAR(32) DEFAULT 'pending',
    -- pending → prepared → syncing → indexed → sync_failed
  kb_ingestion_job_id VARCHAR(128),
  kb_sync_retries INTEGER DEFAULT 0,
  
  -- S3 paths
  s3_raw_path VARCHAR(1024),
  s3_extracted_path VARCHAR(1024),
  s3_kb_ready_path VARCHAR(1024),
  
  -- Intake summary (cached for instant first response)
  intake_summary TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_tenant_workspace ON documents(tenant_id, workspace_id);
CREATE INDEX idx_documents_tenant_status ON documents(tenant_id, processing_status);
CREATE INDEX idx_documents_kb_sync ON documents(kb_sync_status) WHERE kb_sync_status != 'indexed';

-- Extracted metrics from uploaded documents
-- CRITICAL: normalized_metric uses MetricRegistry canonical IDs
-- so the existing structured retriever finds them via synonym lookup
CREATE TABLE extracted_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id),
  ticker VARCHAR(16),
  
  normalized_metric VARCHAR(128) NOT NULL,  -- CANONICAL ID from MetricRegistry
  raw_label VARCHAR(256),                    -- Original label from document (for audit)
  value NUMERIC NOT NULL,
  unit VARCHAR(32),                          -- USD, EUR, %, ratio, bps, count
  period VARCHAR(32),                        -- FY2024, Q3 2025, LTM Sep 2025
  period_end_date DATE,
  context VARCHAR(64),                       -- GAAP, non-GAAP, adjusted, pro-forma, management
  output_format VARCHAR(32) DEFAULT 'number', -- percentage, ratio, currency, count
  yoy_change NUMERIC,
  yoy_change_pct NUMERIC,
  
  -- Source traceability
  source_page_number INTEGER,
  source_table_id VARCHAR(64),
  source_section VARCHAR(128),
  extraction_confidence VARCHAR(16) DEFAULT 'high',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_extracted_metrics_tenant_ticker ON extracted_metrics(tenant_id, ticker);
CREATE INDEX idx_extracted_metrics_lookup ON extracted_metrics(ticker, normalized_metric);
CREATE INDEX idx_extracted_metrics_document ON extracted_metrics(document_id);

-- Earnings call analysis (one row per call)
CREATE TABLE call_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id),
  ticker VARCHAR(16) NOT NULL,
  quarter VARCHAR(16) NOT NULL,            -- Q3 2025
  call_date DATE,
  
  overall_confidence INTEGER,              -- 1-10
  confidence_rationale TEXT,
  guidance_changed BOOLEAN,
  guidance_direction VARCHAR(32),          -- raised, lowered, maintained, narrowed
  guidance_items JSONB,                    -- Array of guidance metric objects
  tone_analysis JSONB,                     -- Full tone analysis object
  red_flags JSONB,                         -- Array of red flag objects
  topics_not_discussed JSONB,              -- Array of absent topics
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_call_analysis_ticker ON call_analysis(tenant_id, ticker);

-- Document flags (notable items, red flags for provocation engine)
CREATE TABLE document_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id),
  ticker VARCHAR(16),
  
  flag_type VARCHAR(64) NOT NULL,          -- restatement, material_weakness, going_concern, etc.
  severity VARCHAR(16) NOT NULL,           -- info, watch, flag
  description TEXT NOT NULL,
  evidence TEXT,
  source_page_number INTEGER,
  
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_by VARCHAR(128),
  reviewed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_flags_tenant ON document_flags(tenant_id, severity);

-- Excel model formulas (preserves formula graph from financial models)
CREATE TABLE model_formulas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL,
  document_id UUID NOT NULL REFERENCES documents(id),
  
  sheet_name VARCHAR(128) NOT NULL,
  cell_reference VARCHAR(32) NOT NULL,     -- B15
  formula_text TEXT,                        -- =B10-B12-B13
  resolved_metric VARCHAR(128),            -- canonical metric if identifiable
  dependencies JSONB,                      -- Array of cell refs this depends on
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_model_formulas_document ON model_formulas(document_id);
```

### Why PostgreSQL, Not DynamoDB

1. **Single source of truth.** The existing `financial_metrics` table (SEC filing data) and the new `extracted_metrics` table (uploaded doc data) live in the same database. The structured retriever can query both with one query or a UNION, no cross-service calls.

2. **The formula engine already resolves against PostgreSQL.** Computed metrics like `gross_margin_pct = gross_profit / revenue * 100` fetch dependencies from PostgreSQL. If extracted metrics from uploaded docs are also in PostgreSQL, the formula engine works on uploaded doc data without any changes.

3. **JOINs matter.** "Show me Apple's revenue from SEC filings alongside revenue from the uploaded analyst report" is a JOIN between `financial_metrics` and `extracted_metrics` on `ticker + normalized_metric + period`. This is trivial in PostgreSQL, painful across PostgreSQL + DynamoDB.

4. **No new infrastructure.** You already run and pay for RDS. Adding DynamoDB tables adds a new service to monitor, a new failure mode, and a new cost line item for zero benefit.

---

# 10. Bulk Upload: Data Room Ingestion

For Tristone-style deployments where 20-50 documents arrive at once.

## 10.1 Prioritized Processing

```typescript
private prioritizeByDocType(docs: DocumentRecord[]): DocumentRecord[] {
  const priority: Record<string, number> = {
    'cim': 1,
    'financial_model': 2,
    'management_presentation': 3,
    'historical_financials': 4,
    'due_diligence_report': 5,
    'earnings_transcript': 6,
    'data_room_misc': 10,
  };

  return docs.sort((a, b) =>
    (priority[a.documentType] ?? 9) - (priority[b.documentType] ?? 9)
  );
}
```

## 10.2 Progressive Availability with WebSocket Updates

```typescript
async processBulkUpload(files, tenantId, workspaceId, dealId) {
  const docs = await Promise.all(
    files.map(f => this.documentRegistry.register(f, tenantId, workspaceId, dealId))
  );

  const prioritized = this.prioritizeByDocType(docs);
  const batchSize = 5; // Avoid Bedrock throttling

  for (let i = 0; i < prioritized.length; i += batchSize) {
    const batch = prioritized.slice(i, i + batchSize);
    await Promise.all(batch.map(doc => this.processUpload(doc, tenantId, ...)));

    // Notify frontend after each batch
    this.websocket.emit(workspaceId, {
      type: 'bulk_progress',
      processed: Math.min(i + batchSize, prioritized.length),
      total: prioritized.length,
      readyDocs: prioritized.slice(0, i + batchSize).map(d => ({
        id: d.id, name: d.fileName, type: d.documentType,
      })),
      message: `${Math.min(i + batchSize, prioritized.length)} of ${prioritized.length} documents ready`,
    });
  }
}
```

---

# 11. Sync Orchestration

## 11.1 Event-Driven (Immediate)

```
Document upload → S3 Put → EventBridge → Start extraction pipeline
Extraction complete → EventBridge → Update PostgreSQL documents.processing_status
Metrics extracted → Write to PostgreSQL extracted_metrics → Invalidate QUL cache for workspace
Chunks embedded → Write to OpenSearch → Tier 2 available
```

## 11.2 Cron Jobs (Scheduled)

| Job | Frequency | Purpose |
|-----|-----------|---------|
| Bedrock KB sync | Every 15 min | Process pending chunks from kb-ready/ |
| Ephemeral index cleanup | Every 1 hour | Evict OpenSearch indexes with expired TTL |
| EDGAR filing check | Every 6 hours | New SEC filings for tracked tickers |
| Earnings call fetch | Daily | FMP API for new transcripts |
| Extracted metrics validation | Daily | Verify extracted_metrics canonical IDs still resolve in MetricRegistry |
| Stuck job recovery | Every 30 min | Re-queue extractions stuck > 10 min |
| Learning loop batch | Weekly | Unresolved queries → synonym suggestions |

## 11.3 KB Sync Cron Lambda

```typescript
// src/cron/kb-sync.handler.ts

export async function handler() {
  // 1. Find documents ready for KB sync
  const pendingDocs = await prisma.document.findMany({
    where: { kb_sync_status: 'prepared' },
    orderBy: { created_at: 'asc' },
    take: 20,
  });

  // 2. Check for in-flight ingestion jobs (don't double-trigger)
  const activeJobs = await bedrockAgent.listIngestionJobs({
    knowledgeBaseId: KB_ID,
    filters: [{ attribute: 'STATUS', operator: 'EQ', values: ['IN_PROGRESS'] }],
  });

  if (activeJobs.length > 0) {
    console.log(`${activeJobs.length} jobs in progress, skipping`);
    return;
  }

  // 3. Trigger ingestion for each pending document's data source
  for (const doc of pendingDocs) {
    try {
      const result = await bedrockAgent.startIngestionJob({
        knowledgeBaseId: KB_ID,
        dataSourceId: doc.tenantDataSourceId,
      });
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          kb_sync_status: 'syncing',
          kb_ingestion_job_id: result.ingestionJob.ingestionJobId,
          updated_at: new Date(),
        },
      });
    } catch (error) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          kb_sync_status: 'sync_failed',
          kb_sync_retries: doc.kb_sync_retries + 1,
          updated_at: new Date(),
        },
      });
    }
  }
}
```

---

# 12. Intake Summary Generation

When a document finishes extraction (Tier 2 ready), generate a natural language summary served as the first response to the analyst.

## 12.1 Intake Summary Prompt

**Model:** Claude Sonnet 4.5, temperature 0.0

```
You are FundLens Research Assistant. A document has just been processed.
Generate a concise intake summary for the analyst.

EXTRACTED DATA:
Document: {{filename}}
Type: {{document_type}}
Company: {{reporting_entity}}
Period: {{period_covered}}
Pages: {{page_count}}

Headline Metrics:
{{#each top_metrics}}
- {{this.metric_name}}: {{this.value}} {{this.unit}} ({{this.period}})
{{/each}}

Sections Found: {{sections_list}}

Notable Items:
{{#each notable_items}}
- [{{this.severity}}] {{this.item}}
{{/each}}

OUTPUT: Write a 3-5 sentence natural language summary a financial analyst
would find useful. Lead with the most important finding. If there are
notable items (material weakness, restatement, going concern), mention them
prominently. End with a prompt: "What would you like to explore?"
Do NOT use bullet points. Write in conversational prose.
```

---

# 13. Implementation Sequence

| Phase | Scope | Days | Deliverable |
|-------|-------|------|-------------|
| Phase 1 | Document registry + S3 storage + Tier 1 (long-context passthrough) | 1.5 | Upload works, analyst can ask questions immediately via long context |
| Phase 2 | Page vision extraction service + extraction prompt | 2 | PDFs produce structured JSON with tables, charts, metrics |
| Phase 3 | Financial-aware chunking + embedding + OpenSearch indexing (Tier 2) | 1.5 | Uploaded docs get RAG-quality search with citations |
| Phase 4 | Structured metrics → PostgreSQL extracted_metrics + retriever integration | 1.5 | Extracted metrics findable via existing structured retriever + formula engine computes margins from uploaded doc data |
| Phase 5 | Earnings call extractor | 1 | Transcripts produce structured Q&A, guidance, tone analysis |
| Phase 6 | Excel programmatic extractor | 1.5 | Financial models extracted with formulas + cell references |
| Phase 7 | Bedrock KB sync cron + Tier 3 persistence | 1 | Cross-document, cross-session search works |
| Phase 8 | Bulk upload + progressive availability + WebSocket | 1 | Data room ingestion with prioritized processing |
| **Total** | | **~11 days** | |

**Critical path:** Phases 1-4 must ship for the pilot. Phases 5-6 are high priority for Tristone. Phases 7-8 are required for production but can follow.

### Phase 4 Detail: The Retriever Integration

This is the most important phase because it closes the loop between extraction and the retrieval bugs we fixed. After Phase 4:

1. Uploaded document metrics are stored in PostgreSQL `extracted_metrics` with canonical `normalized_metric` values
2. The existing `StructuredRetrieverService.getLatestByFilingType()` can find them via `getSynonyms()` because they use the same canonical IDs
3. The formula engine can compute margins from uploaded doc atomic inputs (e.g., `gross_profit / revenue * 100`) because the dependencies exist in PostgreSQL
4. The source-aware degradation check sees metrics from extracted_metrics and stops reporting false "missing data"
5. The uploaded doc retriever runs in parallel (already fixed) and the chunks have proper metadata for boosted retrieval

```typescript
// The structured retriever needs ONE change to also search extracted_metrics:

async getMetricForEntity(ticker: string, metricId: string): Promise<MetricResult | null> {
  const synonyms = this.metricRegistry.getSynonyms(metricId);
  
  // Search BOTH tables — SEC filing data AND uploaded doc extracted data
  const [secResult, extractedResult] = await Promise.all([
    this.prisma.financialMetric.findFirst({
      where: { ticker, normalizedMetric: { in: synonyms, mode: 'insensitive' } },
      orderBy: { statementDate: 'desc' },
    }),
    this.prisma.extractedMetric.findFirst({
      where: { ticker, normalizedMetric: { in: synonyms, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Prefer SEC filing data (authoritative), fall back to extracted
  // If both exist, return both — let synthesis compare
  if (secResult && extractedResult) {
    return {
      ...this.formatMetric(secResult),
      supplementary: this.formatExtractedMetric(extractedResult),
      sources: ['sec_filing', 'uploaded_document'],
    };
  }
  return secResult ? this.formatMetric(secResult) 
    : extractedResult ? this.formatExtractedMetric(extractedResult) 
    : null;
}
```

---

# 14. How This Connects to the QUL

The QUL spec defines the query side. This spec defines the data side. Together they form the complete pipeline:

```
ANALYST                          DATA SIDE (this spec)
  │                                     │
  │  uploads document ───────────────► Document Intelligence Pipeline
  │                                     │
  │                              ┌──────┴──────┐
  │                              │ Extract     │
  │                              │ Chunk       │
  │                              │ Embed       │
  │                              │ Store       │
  │                              └──────┬──────┘
  │                                     │
  │                    ┌────────────────┼────────────────┐
  │                    │                │                │
  │               PostgreSQL       OpenSearch        Bedrock KB
  │            (extracted_metrics) (ephemeral)       (persistent)
  │                    │                │                │
  │  asks question ─► QUL ─────► Orchestrator ──────────┘
  │                    │         (parallel retrieval
  │                    │          across ALL stores)
  │                    │                │
  │                    │    ┌───────────┼───────────┐
  │                    │    │           │           │
  │                    │ Structured  Uploaded    Bedrock KB
  │                    │ Retriever   Doc RAG    Semantic
  │                    │    │           │           │
  │                    │    └───────────┼───────────┘
  │                    │                │
  │                    │    Formula Engine (computed metrics)
  │                    │                │
  │                    │    Source-Aware Degradation Check
  │                    │    (checks ALL sources before reporting gaps)
  │                    │                │
  │                    │    HybridSynthesis (Sonnet/Opus)
  │                    │    (uploaded docs labeled as authoritative data)
  │                    │                │
  │  ◄──────────── answer with citations + transparency
```

The QUL's `uploaded_documents` field in the Haiku user message is populated from the PostgreSQL `documents` table. The QUL's `uploaded_doc_rag` retrieval path hits the OpenSearch ephemeral index (Tier 2) or Bedrock KB (Tier 3). The QUL's `structured_db` path hits both `financial_metrics` (SEC data) and `extracted_metrics` (uploaded doc data) in the same PostgreSQL instance. The formula engine computes margins from atomic inputs regardless of whether those inputs came from SEC filings or uploaded documents.

---

# 15. Lessons Learned: Hard Rules from RAG Pipeline Debugging

These rules emerged from debugging the "Apple profitability vs ABNB" query failure chain. They are non-negotiable for the pipeline implementation.

### Rule 1: Extracted metrics MUST use MetricRegistry canonical IDs

When the vision extraction prompt returns `metric_name: "Total Revenue"`, the storage layer resolves it to the canonical ID `revenue` before writing to PostgreSQL. If you store raw document labels, you recreate the synonym gap bug.

```
WRONG: normalized_metric = "Total Revenue"   (raw doc label)
WRONG: normalized_metric = "net_sales"        (XBRL tag)
RIGHT: normalized_metric = "revenue"          (canonical ID from MetricRegistry)
```

### Rule 2: Margin percentages are COMPUTED, never ATOMIC

Any metric that's a ratio or percentage derived from two line items must be classified as `type: computed` in the MetricRegistry YAML with an explicit formula and dependencies. If it's classified as `type: atomic`, the retriever will look for it as a direct column in PostgreSQL and fail.

Metrics that MUST be computed: gross_margin_pct, operating_margin_pct, net_margin_pct, return_on_equity, return_on_assets, return_on_invested_capital, debt_to_equity, current_ratio, free_cash_flow_yield, revenue_growth_yoy, ebitda_margin_pct.

### Rule 3: Uploaded doc search runs at the TOP LEVEL, not inside any branch

The orchestrator must start the uploaded doc search promise BEFORE any decomposition, concept expansion, or structured routing. It runs in parallel with everything else and its results are always passed to synthesis.

```typescript
// FIRST LINE of the orchestrator:
const uploadedDocPromise = this.uploadedDocRetriever.search(query, entities);
// ... all other logic ...
// LAST LINE before synthesis:
const uploadedDocChunks = await uploadedDocPromise;
synthesis(structured, semantic, uploadedDocChunks); // ALL THREE
```

### Rule 4: Degradation checks ALL sources before reporting missing data

The degradation system must check structured results + computed results + extracted_metrics + uploaded doc chunks before declaring a metric missing. Only metrics absent from ALL sources get reported. And even then, gaps go in a structured field, never in the analyst-facing response text.

### Rule 5: Synthesis prompt labels uploaded docs as AUTHORITATIVE data sources

The synthesis prompt must have uploaded doc chunks in a separately labeled section, not merged into "narratives." The prompt must explicitly instruct: "If a metric appears in uploaded documents but not in structured metrics, USE IT and cite the source."

### Rule 6: Vector search threshold for uploaded docs is 0.30, not 0.50

Uploaded analyst reports are heterogeneous documents. A threshold of 0.50 filters out useful chunks containing financial tables and margin data. Use 0.30 for uploaded docs, 0.45 for Bedrock KB (SEC filings).

### Rule 7: formatValue() checks output_format, not just value magnitude

The MetricRegistry YAML must carry `output_format` on every metric (percentage, ratio, currency, count). The display layer uses this field to decide formatting, not heuristics like "if value < 1, multiply by 100."

### Rule 8: No synonym collisions in YAML registry

"Gross Margin" must NOT be a synonym of `gross_profit`. "Operating Margin" must NOT be a synonym of `operating_income`. Dollar amounts and percentage metrics are different things. The `rebuildIndex()` method should log warnings on synonym collisions at startup.

---

# 16. Complete Storage Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     PostgreSQL RDS                               │
│                                                                  │
│  financial_metrics    ← SEC filing data (XBRL extraction)        │
│  extracted_metrics    ← Uploaded doc data (vision extraction) NEW │
│  documents            ← Document registry + status tracking  NEW │
│  call_analysis        ← Earnings call structured analysis    NEW │
│  document_flags       ← Red flags + notable items            NEW │
│  model_formulas       ← Excel formula graph                  NEW │
│                                                                  │
│  SHARED: Same canonical normalized_metric IDs across all tables  │
│  SHARED: Same Prisma client, same connection pool                │
│  SHARED: Same structured retriever with getSynonyms()            │
│  SHARED: Same formula engine for computed metrics                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     OpenSearch                                    │
│                                                                  │
│  idx-{tenantId}-{workspaceId}  ← Ephemeral Tier 2 chunks        │
│  Financial-aware chunks with rich metadata                       │
│  1024-dim Titan V2 embeddings                                    │
│  TTL: 24h after last access                                      │
│                                                                  │
│  QUERIED BY: uploadedDocRetriever.search()                       │
│  THRESHOLD: 0.30 (lower than Bedrock KB due to heterogeneous     │
│             content in analyst reports)                           │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Bedrock KB                                    │
│                                                                  │
│  Persistent Tier 3 chunks from SEC filings + synced uploaded docs │
│  Separate data source per tenant for isolation                   │
│  1024-dim Titan V2 embeddings (MUST match OpenSearch)            │
│  Sync via cron every 15 min                                      │
│                                                                  │
│  QUERIED BY: semanticRetriever.search()                          │
│  THRESHOLD: 0.45                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     S3                                            │
│                                                                  │
│  raw/         ← Original uploaded files                          │
│  extracted/   ← Page-by-page JSON extraction output              │
│  kb-ready/    ← Chunks formatted for Bedrock KB ingestion        │
│  metrics/     ← Structured metrics JSON (backup/audit trail)     │
│                                                                  │
│  All paths prefixed: {tenantId}/{workspaceId}/{docId}/           │
└─────────────────────────────────────────────────────────────────┘
```

Everything connects. One query surface (research.html), one understanding layer (QUL), one data layer (this pipeline), PostgreSQL as the single structured data store, OpenSearch + Bedrock KB for semantic search, unified per tenant.
