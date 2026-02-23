/**
 * Document Processor Service for Instant RAG
 * 
 * Handles document extraction for multiple file types:
 * - PDF (text + tables)
 * - DOCX (text)
 * - XLSX (sheets as tables, max 10)
 * - CSV (single table)
 * - TXT (plain text)
 * - PNG/JPG/JPEG (passed to vision API)
 * 
 * Also handles:
 * - Content hash computation for deduplication
 * - Duplicate detection
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 10.1, 10.2
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { VisionPipelineService } from './vision-pipeline.service';
import { createHash } from 'crypto';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// pdf-parse v2.x exports PDFParse class
const { PDFParse } = require('pdf-parse');

// Maximum sheets to extract from XLSX
const MAX_XLSX_SHEETS = 10;

// Supported file types
export const SUPPORTED_FILE_TYPES = ['pdf', 'docx', 'xlsx', 'csv', 'pptx', 'txt', 'png', 'jpg', 'jpeg'];

// MIME type mappings
const MIME_TO_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
};

export interface ExtractedTable {
  sheetName?: string;
  headers: string[];
  rows: any[][];
  rowCount: number;
  columnCount: number;
}

export interface PDFExtraction {
  text: string;
  pageCount: number;
  tables: ExtractedTable[];
}

export interface DOCXExtraction {
  text: string;
  tables: ExtractedTable[];
}

export interface XLSXExtraction {
  sheets: {
    name: string;
    table: ExtractedTable;
  }[];
  truncated: boolean;
  totalSheets: number;
}

export interface CSVExtraction {
  table: ExtractedTable;
}

export interface PPTXExtraction {
  text: string;
  slideCount: number;
  // Images will be added by VisionPipeline
}

export interface ImageExtraction {
  base64Image: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ImageExtraction {
  base64Image: string;
  mimeType: string;
  fileSizeBytes: number;
}

export interface ProcessedDocument {
  documentId: string;
  fileName: string;
  fileType: string;
  fileSizeMb: number;
  contentHash: string;
  extractedText: string;
  extractedTables: ExtractedTable[];
  pageCount: number;
  pageImages?: string[]; // base64-encoded images for vision analysis
  processingStatus: 'pending' | 'processing' | 'complete' | 'failed';
  processingError?: string;
  processingDurationMs: number;
  isDuplicate: boolean;
  existingDocumentId?: string;
}

export interface ExistingDocument {
  id: string;
  fileName: string;
  sessionId: string;
  createdAt: Date;
}

@Injectable()
export class DocumentProcessorService {
  private readonly logger = new Logger(DocumentProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly visionPipeline: VisionPipelineService,
  ) {}

  /**
   * Process a single file and extract content
   */
  async processFile(
    file: Express.Multer.File,
    sessionId: string,
    tenantId: string,
    dealId: string,
  ): Promise<ProcessedDocument> {
    const startTime = Date.now();
    const fileName = file.originalname;
    const fileType = this.getFileType(file.mimetype, fileName);

    this.logger.log(`Processing file: ${fileName} (${fileType}, ${file.size} bytes)`);

    try {
      // Compute content hash
      const contentHash = this.computeContentHash(file.buffer);

      // Check for duplicate
      const existingDoc = await this.checkDuplicate(contentHash, tenantId, dealId);
      if (existingDoc) {
        this.logger.log(`Duplicate detected: ${fileName} matches ${existingDoc.fileName}`);
        return {
          documentId: existingDoc.id,
          fileName,
          fileType,
          fileSizeMb: file.size / (1024 * 1024),
          contentHash,
          extractedText: '',
          extractedTables: [],
          pageCount: 0,
          processingStatus: 'complete',
          processingDurationMs: Date.now() - startTime,
          isDuplicate: true,
          existingDocumentId: existingDoc.id,
        };
      }

      // Extract content based on file type
      let extractedText = '';
      let extractedTables: ExtractedTable[] = [];
      let pageCount = 0;
      let pageImages: string[] | undefined;

      switch (fileType) {
        case 'pdf':
          const pdfResult = await this.extractPDF(file.buffer);
          extractedText = pdfResult.text;
          extractedTables = pdfResult.tables;
          pageCount = pdfResult.pageCount;
          // Render PDF pages to images for vision analysis (charts, colors, graphs)
          try {
            const visionResult = await this.visionPipeline.renderPDF(file.buffer, fileName);
            pageImages = visionResult.images;
            if (visionResult.warnings.length > 0) {
              this.logger.warn(`PDF vision warnings for ${fileName}: ${visionResult.warnings.join(', ')}`);
            }
          } catch (visionError) {
            this.logger.warn(`Vision rendering failed for PDF ${fileName}, continuing with text only: ${visionError.message}`);
          }
          break;

        case 'docx':
          const docxResult = await this.extractDOCX(file.buffer);
          extractedText = docxResult.text;
          extractedTables = docxResult.tables;
          if (extractedTables.length > 0) {
            extractedText += '\n\n' + this.tablesToText(extractedTables);
          }
          pageCount = 1; // DOCX doesn't have page count
          break;

        case 'xlsx':
          const xlsxResult = await this.extractXLSX(file.buffer);
          extractedTables = xlsxResult.sheets.map(s => s.table);
          extractedText = this.tablesToText(extractedTables);
          if (xlsxResult.truncated) {
            this.logger.warn(`XLSX truncated: ${xlsxResult.totalSheets} sheets, only ${MAX_XLSX_SHEETS} extracted`);
          }
          break;

        case 'csv':
          const csvResult = await this.extractCSV(file.buffer);
          extractedTables = [csvResult.table];
          extractedText = this.tablesToText(extractedTables);
          break;

        case 'txt':
          extractedText = this.extractTXT(file.buffer);
          break;

        case 'png':
        case 'jpg':
          // Extract image for vision API analysis
          const imageResult = this.extractImage(file.buffer, fileType, file.size);
          pageImages = [imageResult.base64Image];
          extractedText = `[Image: ${fileName} (${imageResult.mimeType}, ${(imageResult.fileSizeBytes / 1024).toFixed(1)}KB)]`;
          break;

        case 'pptx':
          // Render PPTX slides to images for vision analysis
          try {
            const pptxVision = await this.visionPipeline.renderPPTX(file.buffer, fileName);
            pageImages = pptxVision.images;
            pageCount = pptxVision.pageCount;
            extractedText = `[PowerPoint: ${fileName}, ${pptxVision.renderedCount} slides rendered]`;
            if (pptxVision.truncated) {
              this.logger.warn(`PPTX truncated: ${pptxVision.pageCount} slides, rendered ${pptxVision.renderedCount}`);
            }
          } catch (visionError) {
            this.logger.warn(`Vision rendering failed for PPTX ${fileName}: ${visionError.message}`);
            extractedText = `[PowerPoint: ${fileName} - vision rendering failed]`;
          }
          break;

        default:
          throw new BadRequestException(`Unsupported file type: ${fileType}`);
      }

      const processingDurationMs = Date.now() - startTime;
      this.logger.log(`Processed ${fileName} in ${processingDurationMs}ms: ${extractedText.length} chars, ${extractedTables.length} tables${pageImages ? `, ${pageImages.length} images` : ''}`);

      return {
        documentId: '', // Will be set when stored
        fileName,
        fileType,
        fileSizeMb: file.size / (1024 * 1024),
        contentHash,
        extractedText,
        extractedTables,
        pageCount,
        pageImages,
        processingStatus: 'complete',
        processingDurationMs,
        isDuplicate: false,
      };
    } catch (error) {
      this.logger.error(`Failed to process ${fileName}: ${error.message}`);
      return {
        documentId: '',
        fileName,
        fileType,
        fileSizeMb: file.size / (1024 * 1024),
        contentHash: this.computeContentHash(file.buffer),
        extractedText: '',
        extractedTables: [],
        pageCount: 0,
        processingStatus: 'failed',
        processingError: error.message,
        processingDurationMs: Date.now() - startTime,
        isDuplicate: false,
      };
    }
  }

  /**
   * Extract text and tables from PDF
   */
  async extractPDF(buffer: Buffer): Promise<PDFExtraction> {
    let parser: any;
    try {
      parser = new PDFParse({ data: buffer, verbosity: 0 });
      const textResult = await parser.getText({ pageJoiner: '' });
      
      // Basic table detection from text
      const tables = this.detectTablesInText(textResult.text);

      return {
        text: textResult.text.trim(),
        pageCount: textResult.total,
        tables,
      };
    } catch (error) {
      // Check for password-protected PDF
      if (error.message?.includes('password') || error.message?.includes('encrypted')) {
        throw new BadRequestException('Cannot process password-protected PDF');
      }
      throw error;
    } finally {
      if (parser) {
        try { await parser.destroy(); } catch (_) { /* ignore cleanup errors */ }
      }
    }
  }

  /**
   * Extract text and tables from DOCX
   * Uses mammoth HTML output to parse table structures
   */
  async extractDOCX(buffer: Buffer): Promise<DOCXExtraction> {
    try {
      // Extract raw text
      const textResult = await mammoth.extractRawText({ buffer });
      
      // Extract HTML to parse tables
      const htmlResult = await mammoth.convertToHtml({ buffer });
      const tables = this.extractTablesFromHTML(htmlResult.value);

      return { text: textResult.value, tables };
    } catch (error) {
      // Check for encrypted DOCX
      if (error.message?.includes('encrypt') || error.message?.includes('password')) {
        throw new BadRequestException('Cannot process encrypted DOCX file');
      }
      throw error;
    }
  }

  /**
   * Extract sheets from XLSX (max 10 sheets)
   * Extracts calculated values, not formulas
   */
  async extractXLSX(buffer: Buffer): Promise<XLSXExtraction> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetNames = workbook.SheetNames;
    const totalSheets = sheetNames.length;
    const truncated = totalSheets > MAX_XLSX_SHEETS;

    const sheets: { name: string; table: ExtractedTable }[] = [];

    // Process up to MAX_XLSX_SHEETS
    const sheetsToProcess = sheetNames.slice(0, MAX_XLSX_SHEETS);

    for (const sheetName of sheetsToProcess) {
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON (this extracts calculated values, not formulas)
      const data: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (data.length === 0) continue;

      // First row as headers
      const headers = (data[0] || []).map(h => String(h || ''));
      const rows = data.slice(1);

      sheets.push({
        name: sheetName,
        table: {
          sheetName,
          headers,
          rows,
          rowCount: rows.length,
          columnCount: headers.length,
        },
      });
    }

    return {
      sheets,
      truncated,
      totalSheets,
    };
  }

  /**
   * Extract table from CSV
   */
  async extractCSV(buffer: Buffer): Promise<CSVExtraction> {
    const text = buffer.toString('utf-8');
    const lines = text.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return {
        table: {
          headers: [],
          rows: [],
          rowCount: 0,
          columnCount: 0,
        },
      };
    }

    // Parse CSV (simple implementation, handles basic cases)
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(line => parseCSVLine(line));

    return {
      table: {
        headers,
        rows,
        rowCount: rows.length,
        columnCount: headers.length,
      },
    };
  }

  /**
   * Extract text from TXT file
   */
  extractTXT(buffer: Buffer): string {
    return buffer.toString('utf-8');
  }

  /**
   * Extract image for vision API analysis.
   * Converts buffer to base64 and resolves the correct MIME type.
   * JPEG and JPG are treated identically (both map to image/jpeg).
   * Requirements: 2.7, 2.8
   */
  extractImage(buffer: Buffer, fileType: string, fileSizeBytes: number): ImageExtraction {
    // JPEG/JPG equivalence: both resolve to image/jpeg
    const mimeType = fileType === 'png' ? 'image/png' : 'image/jpeg';
    const base64Image = buffer.toString('base64');

    return {
      base64Image,
      mimeType,
      fileSizeBytes,
    };
  }

  /**
   * Compute SHA-256 content hash
   */
  computeContentHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Check if document with same hash exists for tenant+deal
   */
  async checkDuplicate(
    contentHash: string,
    tenantId: string,
    dealId: string,
  ): Promise<ExistingDocument | null> {
    // Note: tenant_id is TEXT column
    const result = await this.prisma.$queryRaw<ExistingDocument[]>`
      SELECT id, file_name as "fileName", session_id as "sessionId", created_at as "createdAt"
      FROM instant_rag_documents
      WHERE content_hash = ${contentHash}
        AND tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    return result[0] || null;
  }

  /**
   * Get file type from MIME type or extension
   */
  getFileType(mimeType: string, fileName: string): string {
    // Try MIME type first
    if (MIME_TO_TYPE[mimeType]) {
      return MIME_TO_TYPE[mimeType];
    }

    // Fall back to extension
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext && SUPPORTED_FILE_TYPES.includes(ext)) {
      // Normalize jpeg to jpg
      return ext === 'jpeg' ? 'jpg' : ext;
    }

    return 'unknown';
  }

  /**
   * Check if file type is supported
   */
  isSupported(fileType: string): boolean {
    return SUPPORTED_FILE_TYPES.includes(fileType);
  }

  /**
   * Convert tables to text representation
   */
  private tablesToText(tables: ExtractedTable[]): string {
    return tables.map((table, idx) => {
      const header = table.sheetName ? `Sheet: ${table.sheetName}` : `Table ${idx + 1}`;
      const headerRow = table.headers.join(' | ');
      const dataRows = table.rows.map(row => 
        row.map(cell => String(cell ?? '')).join(' | ')
      ).join('\n');
      
      return `${header}\n${headerRow}\n${dataRows}`;
    }).join('\n\n');
  }

  /**
   * Detect tables in text using multiple strategies:
   * 1. Markdown-style tables (pipe-delimited)
   * 2. Column-aligned text (common in PDF financial statements)
   * 3. Tab-delimited rows
   * 
   * Also merges multi-page table continuations.
   * Requirements: 4.11
   */
  private detectTablesInText(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];

    // Strategy 1: Markdown-style tables
    tables.push(...this.detectMarkdownTables(text));

    // Strategy 2: Tab-delimited tables
    tables.push(...this.detectTabDelimitedTables(text));

    // Strategy 3: Column-aligned tables (financial statements)
    if (tables.length === 0) {
      tables.push(...this.detectColumnAlignedTables(text));
    }

    // Merge multi-page table continuations
    return this.mergeMultiPageTables(tables);
  }

  /**
   * Detect markdown-style pipe-delimited tables
   */
  private detectMarkdownTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const tablePattern = /(\|[^\n]+\|[\s\S]*?(?=\n\n|\n[^|]|$))/g;
    const matches = text.match(tablePattern) || [];

    for (const match of matches) {
      const lines = match.split('\n').filter(l => l.trim().startsWith('|'));
      if (lines.length < 2) continue;

      const parseRow = (line: string): string[] => {
        return line.split('|')
          .map(cell => cell.trim())
          .filter(cell => cell.length > 0);
      };

      const headers = parseRow(lines[0]);
      const startIdx = lines[1]?.includes('---') ? 2 : 1;
      const rows = lines.slice(startIdx).map(parseRow);

      if (headers.length > 0 && rows.length > 0) {
        tables.push({
          headers,
          rows,
          rowCount: rows.length,
          columnCount: headers.length,
        });
      }
    }

    return tables;
  }

  /**
   * Detect tab-delimited tables in text
   */
  private detectTabDelimitedTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const lines = text.split('\n');
    let tableLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('\t') && line.split('\t').length >= 2) {
        tableLines.push(line);
      } else {
        if (tableLines.length >= 2) {
          const table = this.parseTabDelimitedBlock(tableLines);
          if (table) tables.push(table);
        }
        tableLines = [];
      }
    }

    // Handle trailing table
    if (tableLines.length >= 2) {
      const table = this.parseTabDelimitedBlock(tableLines);
      if (table) tables.push(table);
    }

    return tables;
  }

  /**
   * Parse a block of tab-delimited lines into a table
   */
  private parseTabDelimitedBlock(lines: string[]): ExtractedTable | null {
    if (lines.length < 2) return null;

    const parseLine = (line: string): string[] =>
      line.split('\t').map(cell => cell.trim());

    const headers = parseLine(lines[0]);
    const rows = lines.slice(1).map(parseLine);

    // Normalize column count to match headers
    const normalizedRows = rows.map(row => {
      while (row.length < headers.length) row.push('');
      return row.slice(0, headers.length);
    });

    return {
      headers,
      rows: normalizedRows,
      rowCount: normalizedRows.length,
      columnCount: headers.length,
    };
  }

  /**
   * Detect column-aligned tables common in PDF financial statements.
   * Looks for blocks of lines where numeric values are right-aligned
   * in consistent column positions.
   */
  private detectColumnAlignedTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const lines = text.split('\n');
    
    // Financial number pattern: optional $, digits with commas, optional decimals, optional parens for negatives
    const numericPattern = /[\$]?\(?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?/;
    
    let tableBlock: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimEnd();
      if (!line.trim()) {
        if (tableBlock.length >= 3) {
          const table = this.parseColumnAlignedBlock(tableBlock);
          if (table) tables.push(table);
        }
        tableBlock = [];
        continue;
      }

      // A line is "tabular" if it has multiple space-separated segments
      // with at least one numeric value
      const hasNumbers = numericPattern.test(line);
      const hasMultipleSpaceGaps = /\S\s{2,}\S/.test(line);

      if (hasNumbers && hasMultipleSpaceGaps) {
        tableBlock.push(line);
      } else if (tableBlock.length > 0 && hasMultipleSpaceGaps) {
        // Could be a header or label row within a table
        tableBlock.push(line);
      } else {
        if (tableBlock.length >= 3) {
          const table = this.parseColumnAlignedBlock(tableBlock);
          if (table) tables.push(table);
        }
        tableBlock = [];
      }
    }

    // Handle trailing block
    if (tableBlock.length >= 3) {
      const table = this.parseColumnAlignedBlock(tableBlock);
      if (table) tables.push(table);
    }

    return tables;
  }

  /**
   * Parse a block of column-aligned text into a table.
   * Detects column boundaries by finding consistent gaps across rows.
   */
  private parseColumnAlignedBlock(lines: string[]): ExtractedTable | null {
    if (lines.length < 2) return null;

    // Find column boundaries by detecting consistent multi-space gaps
    const gapPositions = new Map<number, number>();

    for (const line of lines) {
      const gapPattern = /\s{2,}/g;
      let match;
      while ((match = gapPattern.exec(line)) !== null) {
        const pos = match.index;
        gapPositions.set(pos, (gapPositions.get(pos) || 0) + 1);
      }
    }

    // Column boundaries are gaps that appear in at least half the rows
    const threshold = Math.floor(lines.length / 2);
    const boundaries = Array.from(gapPositions.entries())
      .filter(([_, count]) => count >= threshold)
      .map(([pos]) => pos)
      .sort((a, b) => a - b);

    if (boundaries.length === 0) return null;

    // Merge boundaries that are too close (within 3 chars)
    const mergedBoundaries: number[] = [boundaries[0]];
    for (let i = 1; i < boundaries.length; i++) {
      if (boundaries[i] - mergedBoundaries[mergedBoundaries.length - 1] > 3) {
        mergedBoundaries.push(boundaries[i]);
      }
    }

    // Split each line at boundaries
    const splitLine = (line: string): string[] => {
      const cells: string[] = [];
      let prev = 0;
      for (const boundary of mergedBoundaries) {
        cells.push(line.substring(prev, boundary).trim());
        prev = boundary;
      }
      cells.push(line.substring(prev).trim());
      return cells.filter(c => c.length > 0 || cells.length <= mergedBoundaries.length + 1);
    };

    const allRows = lines.map(splitLine);
    if (allRows.length < 2) return null;

    // First row is headers, rest are data
    const headers = allRows[0];
    const rows = allRows.slice(1);

    // Normalize column count
    const maxCols = Math.max(headers.length, ...rows.map(r => r.length));
    const normalizedHeaders = [...headers];
    while (normalizedHeaders.length < maxCols) normalizedHeaders.push('');

    const normalizedRows = rows.map(row => {
      const r = [...row];
      while (r.length < maxCols) r.push('');
      return r.slice(0, maxCols);
    });

    return {
      headers: normalizedHeaders,
      rows: normalizedRows,
      rowCount: normalizedRows.length,
      columnCount: maxCols,
    };
  }

  /**
   * Extract tables from HTML content (used for DOCX table extraction).
   * Parses <table> elements and extracts rows/columns.
   */
  extractTablesFromHTML(html: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    
    // Match <table>...</table> blocks
    const tablePattern = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;

    while ((tableMatch = tablePattern.exec(html)) !== null) {
      const tableHtml = tableMatch[1];
      
      // Extract all rows
      const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      const allRows: string[][] = [];
      let rowMatch;

      while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
        const rowHtml = rowMatch[1];
        const cells: string[] = [];
        
        // Match both <th> and <td> cells
        const cellPattern = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
        let cellMatch;

        while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
          // Strip inner HTML tags and decode entities
          const cellText = cellMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, ' ')
            .trim();
          cells.push(cellText);
        }

        if (cells.length > 0) {
          allRows.push(cells);
        }
      }

      if (allRows.length >= 2) {
        const headers = allRows[0];
        const rows = allRows.slice(1);

        // Normalize column count
        const maxCols = Math.max(headers.length, ...rows.map(r => r.length));
        while (headers.length < maxCols) headers.push('');
        const normalizedRows = rows.map(row => {
          const r = [...row];
          while (r.length < maxCols) r.push('');
          return r.slice(0, maxCols);
        });

        tables.push({
          headers,
          rows: normalizedRows,
          rowCount: normalizedRows.length,
          columnCount: maxCols,
        });
      }
    }

    return tables;
  }

  /**
   * Merge tables that appear to be continuations across page breaks.
   * Two consecutive tables are merged if they have the same column count
   * and compatible headers.
   */
  private mergeMultiPageTables(tables: ExtractedTable[]): ExtractedTable[] {
    if (tables.length <= 1) return tables;

    const merged: ExtractedTable[] = [];
    let current = tables[0];

    for (let i = 1; i < tables.length; i++) {
      const next = tables[i];

      if (this.shouldMergeTables(current, next)) {
        // Merge: append next's rows to current
        current = {
          sheetName: current.sheetName,
          headers: current.headers,
          rows: [...current.rows, ...next.rows],
          rowCount: current.rowCount + next.rowCount,
          columnCount: current.columnCount,
        };
      } else {
        merged.push(current);
        current = next;
      }
    }

    merged.push(current);
    return merged;
  }

  /**
   * Determine if two tables should be merged (multi-page continuation).
   * Tables are merged if they have the same column count and
   * their headers match or the second table's first row looks like data.
   */
  private shouldMergeTables(a: ExtractedTable, b: ExtractedTable): boolean {
    // Must have same column count
    if (a.columnCount !== b.columnCount) return false;

    // Check if headers match exactly
    const headersMatch = a.headers.every(
      (h, i) => h.toLowerCase().trim() === (b.headers[i] || '').toLowerCase().trim()
    );
    if (headersMatch) return true;

    // Check if second table's "headers" look like data (contain numbers)
    const numericPattern = /[\$]?\(?\d{1,3}(?:,\d{3})*(?:\.\d+)?\)?/;
    const secondHeadersAreData = b.headers.some(h => numericPattern.test(h));
    if (secondHeadersAreData) return true;

    return false;
  }
}
