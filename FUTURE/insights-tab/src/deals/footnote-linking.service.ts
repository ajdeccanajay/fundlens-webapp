import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Footnote Reference - Links metrics to explanatory footnotes
 */
export interface FootnoteReference {
  id?: string;
  dealId: string;
  metricId: string;
  footnoteNumber: string;
  footnoteSection: string;
  footnoteText: string;
  contextType: 'accounting_policy' | 'segment_breakdown' | 'reconciliation' | 'other';
  extractedData?: Record<string, any>;
}

/**
 * Extracted Footnote Data - Structured data from footnote tables
 */
export interface ExtractedFootnoteData {
  type: 'table' | 'list' | 'text';
  data: any;
  headers?: string[];
  rows?: any[][];
}

/**
 * FootnoteLinkingService
 * 
 * Links financial metrics to their explanatory footnotes and extracts
 * structured data from footnote sections.
 * 
 * Features:
 * - Extract footnote references from metric labels
 * - Match footnote numbers to footnote text
 * - Extract structured data from footnote tables
 * - Classify footnote types
 * - Store footnote references in database
 */
@Injectable()
export class FootnoteLinkingService {
  private readonly logger = new Logger(FootnoteLinkingService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Link footnotes to metrics for a deal
   */
  async linkFootnotesToMetrics(
    dealId: string,
    metrics: any[],
    htmlContent: string
  ): Promise<FootnoteReference[]> {
    this.logger.log(`Linking footnotes for deal ${dealId}`);

    const references: FootnoteReference[] = [];

    for (const metric of metrics) {
      const footnoteRefs = this.extractFootnoteReferences(metric.raw_label || metric.label);
      
      for (const refNum of footnoteRefs) {
        const footnote = this.findFootnoteByNumber(htmlContent, refNum);
        
        if (footnote) {
          const reference: FootnoteReference = {
            dealId,
            metricId: metric.id,
            footnoteNumber: refNum,
            footnoteSection: footnote.section,
            footnoteText: footnote.text,
            contextType: this.classifyFootnote(footnote.text),
            extractedData: this.extractStructuredData(footnote.text)
          };

          references.push(reference);
        }
      }
    }

    this.logger.log(`Found ${references.length} footnote references`);
    return references;
  }

  /**
   * Extract footnote reference numbers from metric label
   * Examples: "Revenue (1)", "Net Income (2,3)", "Assets [1]"
   */
  private extractFootnoteReferences(label: string): string[] {
    if (!label) return [];

    const references: string[] = [];

    // Pattern 1: (1), (2), (3)
    const pattern1 = /\((\d+(?:,\s*\d+)*)\)/g;
    let match;
    while ((match = pattern1.exec(label)) !== null) {
      const nums = match[1].split(',').map(n => n.trim());
      references.push(...nums);
    }

    // Pattern 2: [1], [2], [3]
    const pattern2 = /\[(\d+(?:,\s*\d+)*)\]/g;
    while ((match = pattern2.exec(label)) !== null) {
      const nums = match[1].split(',').map(n => n.trim());
      references.push(...nums);
    }

    // Pattern 3: Superscript numbers (if present in HTML)
    const pattern3 = /<sup>(\d+)<\/sup>/g;
    while ((match = pattern3.exec(label)) !== null) {
      references.push(match[1]);
    }

    return [...new Set(references)]; // Remove duplicates
  }

  /**
   * Find footnote text by number in HTML content
   */
  private findFootnoteByNumber(
    htmlContent: string,
    footnoteNumber: string
  ): { section: string; text: string } | null {
    // Common footnote patterns in SEC filings
    const patterns = [
      // Pattern 1: "Note 1 - Revenue Recognition"
      new RegExp(`Note\\s+${footnoteNumber}[\\s\\-:]+([^\\n]+)([\\s\\S]*?)(?=Note\\s+\\d+|$)`, 'i'),
      
      // Pattern 2: "(1) Revenue Recognition"
      new RegExp(`\\(${footnoteNumber}\\)\\s+([^\\n]+)([\\s\\S]*?)(?=\\(\\d+\\)|$)`, 'i'),
      
      // Pattern 3: "1. Revenue Recognition" (at start of line)
      new RegExp(`^\\s*${footnoteNumber}\\.\\s+([^\\n]+)([\\s\\S]*?)(?=^\\s*\\d+\\.|$)`, 'im')
    ];

    for (const pattern of patterns) {
      const match = htmlContent.match(pattern);
      if (match) {
        return {
          section: match[1].trim(),
          text: match[2] ? match[2].trim().substring(0, 5000) : match[1].trim() // Limit to 5000 chars
        };
      }
    }

    return null;
  }

  /**
   * Classify footnote type based on content
   */
  private classifyFootnote(footnoteText: string): FootnoteReference['contextType'] {
    const lowerText = footnoteText.toLowerCase();

    // Accounting policy keywords
    if (
      lowerText.includes('accounting policy') ||
      lowerText.includes('recognition') ||
      lowerText.includes('measurement') ||
      lowerText.includes('basis of presentation')
    ) {
      return 'accounting_policy';
    }

    // Segment breakdown keywords
    if (
      lowerText.includes('segment') ||
      lowerText.includes('geographic') ||
      lowerText.includes('by region') ||
      lowerText.includes('by product')
    ) {
      return 'segment_breakdown';
    }

    // Reconciliation keywords
    if (
      lowerText.includes('reconciliation') ||
      lowerText.includes('adjusted') ||
      lowerText.includes('non-gaap')
    ) {
      return 'reconciliation';
    }

    return 'other';
  }

  /**
   * Extract structured data from footnote text (tables, lists)
   */
  private extractStructuredData(footnoteText: string): ExtractedFootnoteData | undefined {
    // Try to extract table data
    const tableData = this.extractTableFromText(footnoteText);
    if (tableData) {
      return tableData;
    }

    // Try to extract list data
    const listData = this.extractListFromText(footnoteText);
    if (listData) {
      return listData;
    }

    return undefined;
  }

  /**
   * Extract table data from footnote text
   */
  private extractTableFromText(text: string): ExtractedFootnoteData | null {
    // Look for HTML table tags
    const tableMatch = text.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return null;

    const tableHtml = tableMatch[1];

    // Extract headers
    const headerMatch = tableHtml.match(/<th[^>]*>(.*?)<\/th>/gi);
    const headers = headerMatch
      ? headerMatch.map(h => h.replace(/<[^>]+>/g, '').trim())
      : [];

    // Extract rows
    const rowMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    const rows: any[][] = [];

    if (rowMatches) {
      for (const rowHtml of rowMatches) {
        const cellMatches = rowHtml.match(/<td[^>]*>(.*?)<\/td>/gi);
        if (cellMatches) {
          const cells = cellMatches.map(c => c.replace(/<[^>]+>/g, '').trim());
          rows.push(cells);
        }
      }
    }

    if (rows.length === 0) return null;

    return {
      type: 'table',
      data: { headers, rows },
      headers,
      rows
    };
  }

  /**
   * Extract list data from footnote text
   */
  private extractListFromText(text: string): ExtractedFootnoteData | null {
    // Look for bullet points or numbered lists
    const listItems: string[] = [];

    // Pattern 1: Bullet points (•, -, *)
    const bulletPattern = /^[\s]*[•\-\*]\s+(.+)$/gm;
    let match;
    while ((match = bulletPattern.exec(text)) !== null) {
      listItems.push(match[1].trim());
    }

    // Pattern 2: Numbered lists (1., 2., 3.)
    const numberedPattern = /^[\s]*\d+\.\s+(.+)$/gm;
    while ((match = numberedPattern.exec(text)) !== null) {
      listItems.push(match[1].trim());
    }

    if (listItems.length === 0) return null;

    return {
      type: 'list',
      data: listItems
    };
  }

  /**
   * Save footnote references to database
   */
  async saveFootnoteReferences(references: FootnoteReference[]): Promise<void> {
    this.logger.log(`Saving ${references.length} footnote references`);

    try {
      for (const ref of references) {
        // Upsert using raw SQL (Prisma doesn't have the schema for this table)
        await this.prisma.$executeRawUnsafe(`
          INSERT INTO footnote_references (
            deal_id, metric_id, footnote_number, footnote_section,
            footnote_text, context_type, extracted_data, created_at, updated_at
          )
          VALUES (
            $1::uuid, $2::uuid, $3, $4,
            $5, $6, $7::jsonb, NOW(), NOW()
          )
          ON CONFLICT (deal_id, metric_id, footnote_number) DO UPDATE SET
            footnote_section = EXCLUDED.footnote_section,
            footnote_text = EXCLUDED.footnote_text,
            context_type = EXCLUDED.context_type,
            extracted_data = EXCLUDED.extracted_data,
            updated_at = NOW()
        `,
          ref.dealId,
          ref.metricId,
          ref.footnoteNumber,
          ref.footnoteSection || null,
          ref.footnoteText || null,
          ref.contextType,
          ref.extractedData ? JSON.stringify(ref.extractedData) : null
        );
      }

      this.logger.log(`✅ Footnote references saved successfully: ${references.length} references`);
    } catch (error) {
      this.logger.error(`Failed to save footnote references: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get footnote references for a metric
   */
  async getFootnoteReferencesForMetric(metricId: string): Promise<FootnoteReference[]> {
    try {
      const records = await this.prisma.$queryRawUnsafe(`
        SELECT 
          id, deal_id as "dealId", metric_id as "metricId",
          footnote_number as "footnoteNumber", footnote_section as "footnoteSection",
          footnote_text as "footnoteText", context_type as "contextType",
          extracted_data as "extractedData"
        FROM footnote_references
        WHERE metric_id = $1::uuid
        ORDER BY footnote_number
      `, metricId) as any[];

      return records.map(r => ({
        id: r.id,
        dealId: r.dealId,
        metricId: r.metricId,
        footnoteNumber: r.footnoteNumber,
        footnoteSection: r.footnoteSection,
        footnoteText: r.footnoteText,
        contextType: r.contextType,
        extractedData: r.extractedData
      }));
    } catch (error) {
      this.logger.error(`Failed to get footnote references: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all footnote references for a deal
   */
  async getFootnoteReferencesForDeal(dealId: string): Promise<FootnoteReference[]> {
    try {
      const records = await this.prisma.$queryRawUnsafe(`
        SELECT 
          id, deal_id as "dealId", metric_id as "metricId",
          footnote_number as "footnoteNumber", footnote_section as "footnoteSection",
          footnote_text as "footnoteText", context_type as "contextType",
          extracted_data as "extractedData"
        FROM footnote_references
        WHERE deal_id = $1::uuid
        ORDER BY footnote_number
      `, dealId) as any[];

      return records.map(r => ({
        id: r.id,
        dealId: r.dealId,
        metricId: r.metricId,
        footnoteNumber: r.footnoteNumber,
        footnoteSection: r.footnoteSection,
        footnoteText: r.footnoteText,
        contextType: r.contextType,
        extractedData: r.extractedData
      }));
    } catch (error) {
      this.logger.error(`Failed to get footnote references for deal: ${error.message}`);
      return [];
    }
  }
}
