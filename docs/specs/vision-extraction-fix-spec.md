# Vision Extraction Fix: Eliminate OOM, Keep Full Extraction

## Problem

`pdf-to-img` uses canvas/pdfjs internally, which loads the entire PDF into a V8 canvas at 2x scale. This causes uncatchable V8 OOM aborts — not recoverable with try/catch, not fixable with `--max-old-space-size`. The library iterates ALL pages even when only 15 are needed, and Node 25 on Apple Silicon makes it worse.

**But vision extraction is non-negotiable.** Financial documents contain comp tables, waterfall charts, segment breakdowns, and footnoted adjustments that raw text extraction destroys. Without vision extraction, there is no FundLens.

## Solution: Eliminate pdf-to-img Entirely

**Bedrock Claude (Sonnet 4.5) accepts PDF documents natively via the Messages API.** There is no need to convert PDF pages to images. Send the raw PDF bytes directly to Claude as a `document` content block with `media_type: "application/pdf"`.

This eliminates:
- The `pdf-to-img` dependency entirely
- All canvas/pdfjs memory issues
- The image conversion step
- The scale/DPI configuration complexity

## Architecture

```
Current (BROKEN):
  PDF Buffer → pdf-to-img (ALL pages, scale 2.0) → PNG images in memory → Bedrock Claude Vision
  ↑ OOM HERE

New (FIX):
  PDF Buffer → Split into page ranges → Send PDF bytes directly to Bedrock Claude → Structured JSON
  ↑ No image conversion, no canvas, no OOM
```

## Implementation

### Step 1: Replace `extractWithVision()` in `vision-extraction.service.ts`

Remove all `pdf-to-img` usage. Replace with direct PDF-to-Bedrock calls.

**Key change:** Instead of converting pages to images, send the full PDF to Claude with a prompt that targets specific page ranges. For large PDFs (30+ pages), split into batches of 10 pages each to stay within Bedrock token limits.

```typescript
// OLD — kills Node with OOM
import { pdf } from 'pdf-to-img';

const pages = await pdf(pdfBuffer, { scale: 2.0 });
let pageIndex = 0;
for await (const pageImage of pages) {
  // processes ALL pages, OOMs on large PDFs
}

// NEW — zero image conversion, no OOM risk
async extractWithVision(
  documentId: string,
  pdfBuffer: Buffer,
  rawText: string,
): Promise<VisionExtractionResult> {
  // 1. Identify key pages from raw text (existing logic — keep this)
  const keyPages = await this.identifyKeyPages(rawText);
  
  // 2. Split PDF into individual pages using pdf-lib (lightweight, no canvas)
  const { PDFDocument } = await import('pdf-lib');
  const sourcePdf = await PDFDocument.load(pdfBuffer);
  const totalPages = sourcePdf.getPageCount();
  
  // 3. Process key pages in small batches
  const results: PageExtractionResult[] = [];
  const batchSize = 5; // 5 pages per Bedrock call
  
  for (let i = 0; i < keyPages.length; i += batchSize) {
    const batch = keyPages.slice(i, i + batchSize);
    
    // Create a mini-PDF with just these pages
    const batchPdf = await PDFDocument.create();
    for (const pageNum of batch) {
      if (pageNum < totalPages) {
        const [copiedPage] = await batchPdf.copyPages(sourcePdf, [pageNum]);
        batchPdf.addPage(copiedPage);
      }
    }
    const batchBytes = await batchPdf.save();
    const batchBase64 = Buffer.from(batchBytes).toString('base64');
    
    // Send to Bedrock Claude with vision
    const response = await this.bedrockService.invokeModel({
      modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
      body: {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: batchBase64,
              },
            },
            {
              type: 'text',
              text: this.buildExtractionPrompt(batch, totalPages),
            },
          ],
        }],
      },
    });
    
    const parsed = JSON.parse(response.content[0].text);
    results.push(...parsed.pages);
  }
  
  return { documentId, pages: results };
}
```

### Step 2: Install pdf-lib (lightweight PDF manipulation)

```bash
npm install pdf-lib
```

`pdf-lib` is pure JavaScript, no native dependencies, no canvas, no pdfjs. It handles:
- Loading PDFs
- Counting pages
- Extracting/copying individual pages into new PDFs
- Minimal memory footprint (~50MB for a 100-page PDF)

### Step 3: Remove pdf-to-img dependency

```bash
npm uninstall pdf-to-img
```

Also remove any `canvas` or `pdfjs-dist` peer dependencies that were only needed for `pdf-to-img`.

### Step 4: Update the extraction prompt

The prompt should be aware it's receiving a subset of pages, not the full document:

```typescript
private buildExtractionPrompt(pageNumbers: number[], totalPages: number): string {
  return `You are a financial document extraction specialist. You are viewing pages ${pageNumbers.map(p => p + 1).join(', ')} of a ${totalPages}-page financial document.

For EACH page in this PDF, extract the following as a JSON array:

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
          "table_type": "<one of: financial_statement, comp_table, segment_breakdown, sensitivity_analysis, peer_comparison, fee_schedule, capitalization, other>",
          "title": "<table title or inferred description>",
          "headers": ["<column headers>"],
          "rows": [["<cell values, preserving exact numbers>"]],
          "footnotes": ["<any footnotes referenced in this table>"]
        }
      ],
      "charts": [
        {
          "chart_type": "<bar, line, pie, waterfall, stacked, combo, other>",
          "title": "<chart title>",
          "description": "<detailed description of what the chart shows, including all data points, trends, and axis labels>",
          "data_points": [{"label": "<x-axis label>", "value": "<y-axis value>", "series": "<series name if multiple>"}]
        }
      ],
      "metrics": [
        {
          "metric_name": "<standardized metric name, e.g., 'total_revenue', 'net_income', 'ebitda'>",
          "value": <numeric value>,
          "unit": "<USD, %, ratio, etc.>",
          "period": "<fiscal period, e.g., 'FY2024', 'Q3 2024'>",
          "context": "<any qualifiers: pro forma, adjusted, excluding items, etc.>"
        }
      ],
      "narrative_content": "<key text content, management commentary, risk disclosures — summarized, not verbatim>",
      "footnotes": ["<any footnotes on this page>"]
    }
  ]
}

CRITICAL RULES:
1. Preserve exact numbers — do not round or estimate. A wrong number destroys analyst credibility.
2. For tables: capture EVERY row and column. Do not summarize or truncate.
3. For charts: extract all visible data points. Describe trends quantitatively.
4. Classify metrics using standard financial terminology (revenue, COGS, gross_profit, operating_income, ebitda, net_income, eps, total_assets, total_debt, free_cash_flow, etc.)
5. Note any footnote markers (*, †, (1), (a)) and capture the footnote text.
6. Respond ONLY with valid JSON. No preamble, no markdown backticks.`;
}
```

### Step 5: Fallback strategy

If Bedrock Claude call fails (rate limit, timeout, model error), fall back gracefully:

```typescript
async extractWithVision(
  documentId: string,
  pdfBuffer: Buffer,
  rawText: string,
): Promise<VisionExtractionResult> {
  try {
    // Primary: PDF-native extraction via Bedrock Claude
    return await this.extractWithBedrockPdf(documentId, pdfBuffer, rawText);
  } catch (error) {
    this.logger.warn(
      `Vision extraction failed for ${documentId}, falling back to text-only: ${error.message}`,
    );
    
    // Fallback: Extract what we can from raw text using LLM
    return await this.extractFromTextOnly(documentId, rawText);
  }
}

private async extractFromTextOnly(
  documentId: string,
  rawText: string,
): Promise<VisionExtractionResult> {
  // Use Bedrock Claude (text-only) to extract structured data from raw text
  // This misses charts/visual tables but captures text-based tables and metrics
  const response = await this.bedrockService.invokeModel({
    modelId: 'anthropic.claude-sonnet-4-5-20250929-v1:0',
    body: {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Extract all structured financial data from this document text. Focus on tables, metrics, and key financial figures.\n\n${rawText.substring(0, 50000)}`,
      }],
      system: this.buildExtractionPrompt([], 0), // text-only variant
    },
  });
  
  // Parse and return with extraction_mode='text-only' flag
  const parsed = JSON.parse(response.content[0].text);
  return {
    documentId,
    pages: parsed.pages,
    extractionMode: 'text-only', // Flag for downstream consumers
  };
}
```

### Step 6: Store extraction results

Extraction results go into `intel_document_extractions` table, same as Phase A headline metrics but with `extraction_type='vision'`:

```typescript
// After successful extraction, store each metric/table/chart
for (const page of results.pages) {
  // Store tables as extraction records
  for (const table of page.tables) {
    await this.documentExtractionRepo.save({
      document_id: documentId,
      extraction_type: 'vision_table',
      extraction_key: `${page.page_type}_${table.table_type}_p${page.original_page_number}`,
      extraction_value: table,
      page_number: page.original_page_number,
      verified: false, // Will be verified by deterministic verification step
    });
  }
  
  // Store charts
  for (const chart of page.charts) {
    await this.documentExtractionRepo.save({
      document_id: documentId,
      extraction_type: 'vision_chart',
      extraction_key: `${chart.chart_type}_${chart.title}_p${page.original_page_number}`,
      extraction_value: chart,
      page_number: page.original_page_number,
      verified: false,
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
    });
  }
}
```

## Memory Impact Comparison

| Approach | Memory for 30-page PDF | Failure Mode |
|----------|----------------------|--------------|
| pdf-to-img (scale 2.0) | 2-8 GB (V8 canvas) | Uncatchable OOM abort |
| pdf-to-img (scale 1.0) | 1-4 GB (V8 canvas) | Uncatchable OOM abort |
| pdf-lib + Bedrock PDF | ~50-100 MB | Catchable API errors |

## Dependency Changes

```
REMOVE:
- pdf-to-img
- canvas (if only used by pdf-to-img)
- pdfjs-dist (if only used by pdf-to-img)

ADD:
- pdf-lib (pure JS, ~2MB, no native deps)
```

## Re-enable Vision Extraction

Wherever vision extraction was disabled (likely a flag or early return in `background-enrichment.service.ts`), re-enable it:

```typescript
// Remove this bypass:
// if (true) { return; } // Vision extraction disabled — OOM

// Replace with:
await this.visionExtractionService.extractWithVision(
  document.id,
  pdfBuffer,
  rawText,
);
```

## Testing

1. Upload a small PDF (5 pages) — should complete vision extraction in ~10 seconds
2. Upload a large PDF (30+ pages) — should batch into 6 calls of 5 pages, complete in ~60 seconds
3. Kill Bedrock mid-extraction — should fall back to text-only extraction gracefully
4. Verify `intel_document_extractions` has `vision_table`, `vision_chart`, `vision_metric` records
5. Verify RAG queries can retrieve vision-extracted content via Source 2 (vector search)

## Timeline

This is a focused change:
- Step 1-3: Replace pdf-to-img with pdf-lib + Bedrock PDF (2-3 hours)
- Step 4: Extraction prompt (already written above, 30 min to integrate)
- Step 5: Fallback strategy (1 hour)
- Step 6: Storage (1 hour, mostly exists already)
- Testing: 1-2 hours

**Total: ~6 hours of Kiro implementation time**
