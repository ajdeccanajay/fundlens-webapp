/**
 * Vision Extraction Service — Spec §3.4, §5.1, §5.2
 *
 * Phase B primary extractor: renders PDF pages to images,
 * sends to Claude Sonnet Vision for structured extraction.
 * Parallelized: 4 concurrent pages, ~3-5s each.
 *
 * Cost: ~$0.005/page. Speed: ~15s for 10 key pages (4 parallel).
 */
import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../rag/bedrock.service';
import { S3Service } from '../services/s3.service';

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

/** Spec §5.2 — Vision extraction prompt template */
const VISION_EXTRACTION_PROMPT = `You are a financial document extraction engine. Extract ALL structured data
from this page image with 100% fidelity to what is printed.

RULES:
1. Extract EVERY number exactly as displayed. No rounding, no inference.
2. Parentheses (123) = negative. Note the sign.
3. Capture UNITS: "$M", "$B", "$K", "%", "x" (multiple), "bps".
4. Mark estimates: look for "E", "est.", italics, shading, consensus.
5. Capture footnote references (superscript markers).
6. Identify the TIME PERIOD per column: FY2023, Q3 2024, LTM, NTM, FY2025E.
7. For comp tables: capture company name/ticker AND metric in each cell.
8. For charts: extract title, axis labels, and approximate data point values.

Document type: {{DOCUMENT_TYPE}}
Page number: {{PAGE_NUMBER}}

Return ONLY valid JSON:
{
  "tables": [{
    "tableType": "<income-statement|balance-sheet|comp-table|valuation-summary|segment-breakdown|other>",
    "title": "<visible title>",
    "currency": "<USD|EUR|...>",
    "units": "<millions|billions|thousands|percentage>",
    "headers": [{"cells": ["col1","col2",...], "rowIndex": 0}],
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
}`;

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
   * Spec §3.4 — identifyKeyPages
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
   * Render PDF pages to images and extract structured data via Vision LLM.
   * Parallelized with concurrency limit of 4.
   */
  async extractFromPages(
    s3Key: string,
    keyPages: number[],
    documentType: string,
  ): Promise<VisionPageResult[]> {
    const startTime = Date.now();
    this.logger.log(`Starting vision extraction on ${keyPages.length} pages for ${s3Key}`);

    // Get PDF buffer from S3
    const pdfBuffer = await this.s3.getFileBuffer(s3Key);

    // Render pages to images
    const pageImages = await this.renderPagesToImages(pdfBuffer, keyPages);
    this.logger.log(`Rendered ${pageImages.length} page images (${Date.now() - startTime}ms)`);

    // Process pages in parallel (max 4 concurrent)
    const concurrency = 4;
    const results: VisionPageResult[] = [];

    for (let i = 0; i < pageImages.length; i += concurrency) {
      const batch = pageImages.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(({ pageNumber, imageBase64 }) =>
          this.extractSinglePage(imageBase64, pageNumber, documentType),
        ),
      );
      results.push(...batchResults);
    }

    this.logger.log(
      `Vision extraction complete: ${results.length} pages, ` +
      `${results.reduce((sum, r) => sum + r.tables.length, 0)} tables, ` +
      `${results.reduce((sum, r) => sum + r.charts.length, 0)} charts ` +
      `(${Date.now() - startTime}ms)`,
    );

    return results;
  }

  /**
   * Render specific PDF pages to PNG images using pdf-to-img.
   */
  private async renderPagesToImages(
    pdfBuffer: Buffer,
    pageNumbers: number[],
  ): Promise<{ pageNumber: number; imageBase64: string }[]> {
    try {
      // pdf-to-img v5 is ESM-only, use dynamic import
      const { pdf } = await (Function('return import("pdf-to-img")')() as Promise<any>);

      const pages: { pageNumber: number; imageBase64: string }[] = [];
      let currentPage = 0;

      for await (const image of await pdf(pdfBuffer, { scale: 1.0 })) {
        currentPage++;
        if (pageNumbers.includes(currentPage)) {
          // image is a Buffer (PNG)
          const base64 = Buffer.from(image).toString('base64');
          pages.push({ pageNumber: currentPage, imageBase64: base64 });
        }
        // Stop early if we've got all requested pages
        if (pages.length === pageNumbers.length) break;
      }

      return pages;
    } catch (error) {
      this.logger.warn(`PDF rendering failed, falling back to text-only: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract structured data from a single page image via Vision LLM.
   */
  private async extractSinglePage(
    imageBase64: string,
    pageNumber: number,
    documentType: string,
  ): Promise<VisionPageResult> {
    const prompt = VISION_EXTRACTION_PROMPT
      .replace('{{DOCUMENT_TYPE}}', documentType)
      .replace('{{PAGE_NUMBER}}', String(pageNumber));

    try {
      const response = await this.bedrock.invokeClaudeWithVision({
        prompt,
        images: [{ base64: imageBase64, mediaType: 'image/png' }],
        modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        max_tokens: 4000,
      });

      const parsed = this.parseVisionResponse(response);
      return { pageNumber, ...parsed };
    } catch (error) {
      this.logger.warn(`Vision extraction failed for page ${pageNumber}: ${error.message}`);
      return {
        pageNumber,
        tables: [],
        charts: [],
        narratives: [],
        footnotes: [],
        entities: { companies: [], dates: [], metrics: [] },
      };
    }
  }

  /**
   * Parse Vision LLM JSON response, handling markdown fencing.
   */
  private parseVisionResponse(response: string): Omit<VisionPageResult, 'pageNumber'> {
    const empty = {
      tables: [] as VisionTable[],
      charts: [] as VisionChart[],
      narratives: [] as VisionNarrative[],
      footnotes: [] as VisionFootnote[],
      entities: { companies: [] as string[], dates: [] as string[], metrics: [] as string[] },
    };

    try {
      let json = response.trim();
      // Strip markdown fencing
      if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const parsed = JSON.parse(json);
      return {
        tables: parsed.tables || [],
        charts: parsed.charts || [],
        narratives: parsed.narratives || [],
        footnotes: parsed.footnotes || [],
        entities: parsed.entities || empty.entities,
      };
    } catch {
      this.logger.warn('Failed to parse vision response as JSON');
      return empty;
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
}
