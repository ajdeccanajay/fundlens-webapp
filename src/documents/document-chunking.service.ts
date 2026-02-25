/**
 * Document Chunking Service — Spec §3.4 Step 4
 *
 * Financial-aware chunking that preserves table structure.
 * Chunks are sized for Titan V2 embedding (max 8K tokens ≈ 600 tokens target).
 * Tables are kept as single chunks to avoid splitting rows.
 */
import { Injectable, Logger } from '@nestjs/common';

export interface DocumentChunk {
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
  pageNumber?: number;
  sectionType?: string; // 'table', 'narrative', 'financial-statement', 'risk-factors', etc.
  metadata?: Record<string, any>;
}

export interface ChunkingOptions {
  maxTokens?: number;       // Default 600
  overlap?: number;         // Default 100 chars
  preserveTables?: boolean; // Default true
  documentType?: string;
  extractedMetrics?: any[];
}

@Injectable()
export class DocumentChunkingService {
  private readonly logger = new Logger(DocumentChunkingService.name);

  /**
   * Chunk raw text with financial-awareness.
   * Tables and structured sections are kept intact as single chunks.
   */
  chunk(
    rawText: string,
    visionResults: any[] = [],
    options: ChunkingOptions = {},
  ): DocumentChunk[] {
    const maxTokens = options.maxTokens || 600;
    const overlap = options.overlap || 100;
    const maxChars = maxTokens * 4; // ~4 chars per token

    const chunks: DocumentChunk[] = [];
    let chunkIndex = 0;

    // Step 1: Extract table blocks from vision results
    const tableChunks = this.extractTableChunks(visionResults);
    for (const tc of tableChunks) {
      chunks.push({ ...tc, chunkIndex: chunkIndex++ });
    }

    // Step 2: Split remaining text into sections
    const sections = this.splitIntoSections(rawText, options.documentType);

    for (const section of sections) {
      if (section.content.length <= maxChars) {
        // Small section — single chunk
        chunks.push({
          chunkIndex: chunkIndex++,
          content: section.content.trim(),
          tokenEstimate: Math.ceil(section.content.length / 4),
          sectionType: section.type,
          pageNumber: section.pageNumber,
        });
      } else {
        // Large section — split with overlap, respecting sentence boundaries
        const subChunks = this.splitWithOverlap(
          section.content, maxChars, overlap, section.type, section.pageNumber,
        );
        for (const sc of subChunks) {
          chunks.push({ ...sc, chunkIndex: chunkIndex++ });
        }
      }
    }

    // Filter out empty/tiny chunks
    const filtered = chunks.filter(c => c.content.trim().length > 50);

    this.logger.log(
      `Chunked document into ${filtered.length} chunks (${tableChunks.length} table chunks)`,
    );
    return filtered;
  }

  /**
   * Extract table blocks from vision results as standalone chunks.
   * Tables should never be split across chunks.
   */
  private extractTableChunks(visionResults: any[]): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];

    for (const vr of visionResults) {
      const tables = vr.tables || [];
      for (const table of tables) {
        const tableText = this.formatTableAsText(table);
        if (tableText.length > 50) {
          chunks.push({
            chunkIndex: 0, // Will be reassigned
            content: tableText,
            tokenEstimate: Math.ceil(tableText.length / 4),
            sectionType: table.tableType || 'table',
            pageNumber: vr.pageNumber,
            metadata: {
              tableTitle: table.title,
              tableType: table.tableType,
              units: table.units,
            },
          });
        }
      }
    }

    return chunks;
  }

  /**
   * Format a vision-extracted table as readable text for embedding.
   */
  private formatTableAsText(table: any): string {
    const lines: string[] = [];

    if (table.title) lines.push(`Table: ${table.title}`);
    if (table.units) lines.push(`Units: ${table.units}`);

    // Headers
    if (table.headers?.length > 0) {
      for (const headerRow of table.headers) {
        const cells = (headerRow.cells || []).map((c: any) =>
          typeof c === 'string' ? c : c.value || '',
        );
        lines.push(cells.join(' | '));
      }
      lines.push('---');
    }

    // Rows
    for (const row of table.rows || []) {
      const label = row.label || '';
      const cells = (row.cells || []).map((c: any) =>
        typeof c === 'string' ? c : c.value || '',
      );
      lines.push(`${label} | ${cells.join(' | ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Split text into logical sections based on document structure.
   */
  private splitIntoSections(
    rawText: string,
    documentType?: string,
  ): { content: string; type: string; pageNumber?: number }[] {
    const sections: { content: string; type: string; pageNumber?: number }[] = [];

    // Financial document section patterns
    const sectionPatterns = [
      { pattern: /(?:consolidated\s+)?(?:statements?\s+of\s+)?(?:operations|income|earnings)/i, type: 'income-statement' },
      { pattern: /balance\s+sheet/i, type: 'balance-sheet' },
      { pattern: /(?:statements?\s+of\s+)?cash\s+flow/i, type: 'cash-flow' },
      { pattern: /risk\s+factors/i, type: 'risk-factors' },
      { pattern: /management.s?\s+discussion/i, type: 'mda' },
      { pattern: /(?:comparable|comp)\s+(?:companies|analysis)/i, type: 'comp-table' },
      { pattern: /(?:valuation|dcf|discounted)/i, type: 'valuation' },
      { pattern: /(?:executive|investment)\s+summary/i, type: 'summary' },
    ];

    // Split by form-feed (page breaks) or double newlines
    const rawSections = rawText.split(/\f|\n{3,}/);

    for (let i = 0; i < rawSections.length; i++) {
      const content = rawSections[i].trim();
      if (content.length < 50) continue;

      // Classify section
      let sectionType = 'narrative';
      for (const sp of sectionPatterns) {
        if (sp.pattern.test(content.substring(0, 500))) {
          sectionType = sp.type;
          break;
        }
      }

      sections.push({ content, type: sectionType });
    }

    // If no sections found (no page breaks), treat as single block
    if (sections.length === 0 && rawText.trim().length > 50) {
      sections.push({ content: rawText.trim(), type: 'narrative' });
    }

    return sections;
  }

  /**
   * Split a large text block with overlap, respecting sentence boundaries.
   */
  private splitWithOverlap(
    text: string,
    maxChars: number,
    overlapChars: number,
    sectionType: string,
    pageNumber?: number,
  ): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + maxChars, text.length);

      // Try to break at sentence boundary
      if (end < text.length) {
        const segment = text.substring(start, end);
        const lastPeriod = segment.lastIndexOf('. ');
        const lastNewline = segment.lastIndexOf('\n');
        const breakPoint = Math.max(lastPeriod, lastNewline);

        if (breakPoint > maxChars * 0.6) {
          end = start + breakPoint + 1;
        }
      }

      const content = text.substring(start, end).trim();
      if (content.length > 50) {
        chunks.push({
          chunkIndex: 0, // Will be reassigned by caller
          content,
          tokenEstimate: Math.ceil(content.length / 4),
          sectionType,
          pageNumber,
        });
      }

      start = end - overlapChars;
      if (start >= text.length) break;
    }

    return chunks;
  }
}
