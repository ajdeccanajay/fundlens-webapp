/**
 * Vision Extraction Service — Spec §3.4, §5.1, §5.2
 *
 * Phase B primary extractor: splits PDF into page-range batches via pdf-lib,
 * sends raw PDF bytes directly to Bedrock Claude as document content blocks.
 * No image conversion, no canvas, no OOM risk.
 *
 * Replaces the old pdf-to-img approach which caused uncatchable V8 OOM aborts.
 * pdf-lib is pure JS (~50MB for 100-page PDF) vs pdf-to-img (2-8GB canvas).
 */
import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../rag/bedrock.service';
import { S3Service } from '../services/s3.service';
import { PDFDocument } from 'pdf-lib';

/** Spec §5.2 — Vision extraction output per page */
export interface VisionPageResult {
  pageNumber: number;
  tables: VisionTable[];
  charts: VisionChart[];
  narratives: VisionNarrative[];
  footnotes: VisionFootnote[];
  entities: { companies: string[]; dates: string[]; metrics: string[] };
}

export interface VisionTable {
  tableType: string;
  title: string;
  currency?: string;
  units?: string;
  headers: { cells: string[]; rowIndex: number }[];
  rows: {
    label: string;
    cells: {
      value: string;
      numericValue: number | null;
      isNegative: boolean;
      isEstimate: boolean;
      period?: string;
    }[];
    footnoteRefs?: string[];
  }[];
}

export interface VisionChart {
  chartType: string;
  title: string;
  dataPoints: { label: string; value: number; series?: string }[];
}

export interface VisionNarrative {
  type: 'heading' | 'paragraph' | 'bullet' | 'callout';
  text: string;
}

export interface VisionFootnote {
  marker: string;
  text: string;
}

@Injectable()
export class VisionExtractionService {
  private readonly logger = new Logger(VisionExtractionService.name);

  constructor(
    private readonly bedrock: BedrockService,
    private readonly s3: S3Service,
  ) {}

  /**
   * Identify which pages are "key pages" worth sending to Vision LLM.
   * Key pages contain tables, charts, or dense financial data.
   * Spec §3.4 — identifyKeyPages (text-based, no memory issues)
   */
  identifyKeyPages(rawText: string, documentType: string): number[] {
    const pages = rawText.split(/\f|\n{4,}/); // Form feeds or large gaps = page breaks
    const keyPages: number[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (!page || page.trim().length < 50) continue;

      const isKeyPage =
        // Tables: rows of numbers, pipes, tabs
        /\d[\d,.]+\s+\d[\d,.]+\s+\d[\d,.]+/.test(page) ||
        // Financial keywords
        /\b(revenue|ebitda|eps|price target|comp|valuation|dcf|wacc|irr)\b/i.test(page) ||
        // Table-like structure
        (page.match(/\t/g) || []).length > 10 ||
        // Lots of numbers (financial tables)
        (page.match(/\$[\d,.]+/g) || []).length > 5 ||
        // Percentage-heavy (comp tables, margins)
        (page.match(/[\d.]+%/g) || []).length > 3 ||
        // Multiple-heavy (valuation)
        (page.match(/[\d.]+x\b/g) || []).length > 2;

      if (isKeyPage) {
        keyPages.push(i + 1); // 1-indexed page numbers
      }
    }

    // Always include first 2 pages (cover + summary) and last page
    const totalPages = pages.length;
    const always = [1, 2, totalPages].filter(p => p > 0 && p <= totalPages);
    const merged = [...new Set([...always, ...keyPages])].sort((a, b) => a - b);

    // Cap at 15 pages to control cost (~$0.075 max)
    return merged.slice(0, 15);
  }

  /**
   * Extract structured data from PDF pages using Bedrock Claude's native PDF support.
   * Splits PDF into batches of 5 pages via pdf-lib, sends raw PDF bytes to Claude.
   * Falls back to text-only extraction if Bedrock PDF call fails.
   */
  async extractFromPages(
    s3Key: string,
    keyPages: number[],
    documentType: string,
  ): Promise<VisionPageResult[]> {
    const startTime = Date.now();
    this.logger.log(`Starting vision extraction on ${keyPages.length} pages for ${s3Key}`);

    // Memory guard: check heap usage before starting vision extraction
    const heapUsed = process.memoryUsage().heapUsed;
    const heapLimit = 1.5 * 1024 * 1024 * 1024; // 1.5GB (lowered from 3GB — leaves room for chunking + embedding)
    if (heapUsed > heapLimit) {
      this.logger.warn(
        `Skipping vision extraction — heap usage ${(heapUsed / 1024 / 1024).toFixed(0)}MB exceeds 1.5GB limit`,
      );
      return [];
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await this.s3.getFileBuffer(s3Key);
    } catch (err) {
      this.logger.warn(`Failed to fetch PDF from S3: ${err.message}`);
      return [];
    }

    // Size guard: skip vision for very large PDFs (> 50MB raw)
    if (pdfBuffer.length > 50 * 1024 * 1024) {
      this.logger.warn(
        `Skipping vision extraction — PDF too large: ${(pdfBuffer.length / 1024 / 1024).toFixed(1)}MB`,
      );
      return [];
    }

    try {
      const results = await this.extractWithBedrockPdf(pdfBuffer, keyPages, documentType, startTime);
      // Memory cleanup: null out pdfBuffer so GC can reclaim before downstream work
      pdfBuffer = null as any;
      return results;
    } catch (error) {
      this.logger.warn(
        `PDF-native extraction failed, falling back to text-only: ${error.message}`,
      );
      pdfBuffer = null as any;
      return [];
    }
  }

  /**
   * Primary path: split PDF into page-range batches, send raw PDF bytes to Bedrock Claude.
   * Uses pdf-lib (pure JS, no native deps) for PDF splitting.
   */
  private async extractWithBedrockPdf(
    pdfBuffer: Buffer,
    keyPages: number[],
    documentType: string,
    startTime: number,
  ): Promise<VisionPageResult[]> {
    let sourcePdf = await PDFDocument.load(pdfBuffer);
    const totalPages = sourcePdf.getPageCount();

    const results: VisionPageResult[] = [];
    const batchSize = 5; // 5 pages per Bedrock call

    for (let i = 0; i < keyPages.length; i += batchSize) {
      const batch = keyPages.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(keyPages.length / batchSize);

      this.logger.log(
        `Vision batch ${batchNum}/${totalBatches}: pages [${batch.join(', ')}]`,
      );

      try {
        // Create a mini-PDF with just these pages
        const batchPdf = await PDFDocument.create();
        const validPages: number[] = [];

        for (const pageNum of batch) {
          const zeroIndexed = pageNum - 1; // keyPages are 1-indexed
          if (zeroIndexed >= 0 && zeroIndexed < totalPages) {
            const [copiedPage] = await batchPdf.copyPages(sourcePdf, [zeroIndexed]);
            batchPdf.addPage(copiedPage);
            validPages.push(pageNum);
          }
        }

        if (validPages.length === 0) continue;

        const batchBytes = await batchPdf.save();

        // Check batch size — Bedrock document limit is ~25MB
        if (batchBytes.length > 20 * 1024 * 1024) {
          this.logger.warn(
            `Vision batch ${batchNum} too large (${(batchBytes.length / 1024 / 1024).toFixed(1)}MB), skipping`,
          );
          continue;
        }

        const batchBase64 = Buffer.from(batchBytes).toString('base64');

        // Send to Bedrock Claude with native PDF document support
        const response = await this.bedrock.invokeClaudeWithDocument({
          prompt: this.buildExtractionPrompt(validPages, totalPages, documentType),
          documentBase64: batchBase64,
          documentName: `pages_${validPages[0]}_to_${validPages[validPages.length - 1]}`,
          modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
          max_tokens: 8000,
        });

        const parsed = this.parseBatchResponse(response, validPages);
        results.push(...parsed);
      } catch (batchErr) {
        this.logger.warn(
          `Vision batch ${batchNum} failed (non-fatal): ${batchErr.message}`,
        );
        // Continue with remaining batches
      }
    }

    // Memory cleanup: release the source PDF document so GC can reclaim it
    // before downstream chunking + embedding allocates more memory
    sourcePdf = null as any;

    this.logger.log(
      `Vision extraction complete: ${results.length} pages, ` +
      `${results.reduce((sum, r) => sum + r.tables.length, 0)} tables, ` +
      `${results.reduce((sum, r) => sum + r.charts.length, 0)} charts ` +
      `(${Date.now() - startTime}ms)`,
    );

    return results;
  }

  /**
   * Build the extraction prompt for a batch of pages.
   */
  private buildExtractionPrompt(
    pageNumbers: number[],
    totalPages: number,
    documentType: string,
  ): string {
    return `You are a financial document extraction engine. You are viewing pages ${pageNumbers.join(', ')} of a ${totalPages}-page ${documentType} document.

For EACH page in this PDF, extract ALL structured data with 100% fidelity.

RULES:
1. Extract EVERY number exactly as displayed. No rounding, no inference.
2. Parentheses (123) = negative. Note the sign.
3. Capture UNITS: "$M", "$B", "$K", "%", "x" (multiple), "bps".
4. Mark estimates: look for "E", "est.", italics, shading, consensus.
5. Capture footnote references (superscript markers).
6. Identify the TIME PERIOD per column: FY2023, Q3 2024, LTM, NTM, FY2025E.
7. For comp tables: capture company name/ticker AND metric in each cell.
8. For charts: extract title, axis labels, and approximate data point values.

Return ONLY valid JSON (no markdown fencing):
{
  "pages": [
    {
      "original_page_number": <1-indexed page number from the list: ${pageNumbers.join(', ')}>,
      "tables": [{
        "tableType": "<income-statement|balance-sheet|comp-table|valuation-summary|segment-breakdown|other>",
        "title": "<visible title>",
        "currency": "<USD|EUR|...>",
        "units": "<millions|billions|thousands|percentage>",
        "headers": [{"cells": ["col1","col2"], "rowIndex": 0}],
        "rows": [{
          "label": "<row label>",
          "cells": [{
            "value": "<raw display>",
            "numericValue": null,
            "isNegative": false,
            "isEstimate": false,
            "period": "<FY2024|Q3 2024E|LTM|NTM>"
          }],
          "footnoteRefs": []
        }]
      }],
      "charts": [{
        "chartType": "<bar|line|pie|waterfall|scatter|other>",
        "title": "<title>",
        "dataPoints": [{"label": "<x>", "value": 0, "series": "<name>"}]
      }],
      "narratives": [{
        "type": "<heading|paragraph|bullet|callout>",
        "text": "<exact text>"
      }],
      "footnotes": [{"marker": "<1|a|*>", "text": "<footnote text>"}],
      "entities": {
        "companies": [],
        "dates": [],
        "metrics": []
      }
    }
  ]
}`;
  }

  /**
   * Parse the batch response from Bedrock Claude.
   * Maps the response pages back to their original page numbers.
   */
  private parseBatchResponse(
    response: string,
    expectedPages: number[],
  ): VisionPageResult[] {
    const empty: VisionPageResult = {
      pageNumber: 0,
      tables: [],
      charts: [],
      narratives: [],
      footnotes: [],
      entities: { companies: [], dates: [], metrics: [] },
    };

    try {
      let json = response.trim();
      // Strip markdown fencing if present
      if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(json);

      if (!parsed.pages || !Array.isArray(parsed.pages)) {
        // Single-page response — wrap it
        return [{
          pageNumber: expectedPages[0] || 1,
          tables: parsed.tables || [],
          charts: parsed.charts || [],
          narratives: parsed.narratives || [],
          footnotes: parsed.footnotes || [],
          entities: parsed.entities || empty.entities,
        }];
      }

      return parsed.pages.map((page: any, idx: number) => ({
        pageNumber: page.original_page_number || expectedPages[idx] || idx + 1,
        tables: page.tables || [],
        charts: page.charts || [],
        narratives: page.narratives || [],
        footnotes: page.footnotes || [],
        entities: page.entities || empty.entities,
      }));
    } catch {
      this.logger.warn('Failed to parse vision batch response as JSON');
      return [];
    }
  }

  /**
   * Flatten all metrics from vision results into a single array
   * for persistence to intel_document_extractions.
   */
  flattenMetrics(visionResults: VisionPageResult[]): any[] {
    const metrics: any[] = [];

    for (const page of visionResults) {
      for (const table of page.tables) {
        for (const row of table.rows) {
          for (const cell of row.cells) {
            if (cell.numericValue != null) {
              metrics.push({
                metric_key: row.label?.toLowerCase().replace(/\s+/g, '_') || 'unknown',
                raw_value: cell.value,
                numeric_value: cell.numericValue,
                period: cell.period || null,
                is_estimate: cell.isEstimate || false,
                is_negative: cell.isNegative || false,
                page_number: page.pageNumber,
                table_type: table.tableType,
                units: table.units,
              });
            }
          }
        }
      }
    }

    return metrics;
  }

  /**
   * Convert vision extraction results to human-readable text representation.
   * This text gets appended to the raw text S3 file so that long-context-fallback
   * queries include financial tables that pdfplumber missed.
   */
  visionResultsToText(visionResults: VisionPageResult[]): string {
    if (!visionResults || visionResults.length === 0) return '';

    const sections: string[] = [];

    for (const page of visionResults) {
      for (const table of page.tables) {
        const lines: string[] = [];
        const title = table.title || table.tableType || 'Financial Table';
        lines.push(`TABLE: ${title}${table.units ? ` (${table.units})` : ''}${table.currency ? ` [${table.currency}]` : ''}`);

        // Headers
        if (table.headers?.length > 0) {
          for (const header of table.headers) {
            lines.push('| ' + header.cells.join(' | ') + ' |');
            lines.push('| ' + header.cells.map(() => '---').join(' | ') + ' |');
          }
        }

        // Rows
        for (const row of table.rows) {
          const cells = row.cells.map(c => c.value || '');
          lines.push(`| ${row.label} | ${cells.join(' | ')} |`);
        }

        if (lines.length > 1) {
          sections.push(lines.join('\n'));
        }
      }

      // Include chart data points as text
      for (const chart of page.charts) {
        if (chart.dataPoints?.length > 0) {
          const lines: string[] = [`CHART: ${chart.title || chart.chartType}`];
          for (const dp of chart.dataPoints) {
            lines.push(`  ${dp.label}: ${dp.value}${dp.series ? ` (${dp.series})` : ''}`);
          }
          sections.push(lines.join('\n'));
        }
      }
    }

    if (sections.length === 0) return '';

    return '\n\n=== FINANCIAL TABLES (extracted via document vision analysis) ===\n\n' +
      sections.join('\n\n');
  }

}
