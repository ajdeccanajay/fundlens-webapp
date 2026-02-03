import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface ScratchPad {
  id: string;
  dealId: string;
  title: string;
  content: string;
  contentType: 'markdown' | 'html' | 'plain';
  autoSavedAt: Date;
  manuallySavedAt?: Date;
  version: number;
}

export interface UpdateScratchPadDto {
  title?: string;
  content?: string;
  contentType?: 'markdown' | 'html' | 'plain';
}

/**
 * Scratch Pad Service for Investment Memo Management
 * Handles draft content, auto-save, and version management
 */
@Injectable()
export class ScratchPadService {
  private readonly logger = new Logger(ScratchPadService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get scratch pad for a deal
   */
  async getScratchPad(dealId: string): Promise<ScratchPad | null> {
    this.logger.log(`Fetching scratch pad for deal: ${dealId}`);

    const scratchPads = await this.prisma.$queryRaw`
      SELECT 
        id, deal_id as "dealId", title, content, content_type as "contentType",
        auto_saved_at as "autoSavedAt", manually_saved_at as "manuallySavedAt", version
      FROM scratch_pads
      WHERE deal_id = ${dealId}::uuid
      ORDER BY version DESC
      LIMIT 1
    ` as ScratchPad[];

    return scratchPads[0] || null;
  }

  /**
   * Update scratch pad content (auto-save)
   */
  async updateScratchPad(dealId: string, updateDto: UpdateScratchPadDto): Promise<ScratchPad | null> {
    this.logger.log(`Auto-saving scratch pad for deal: ${dealId}`);

    // Check if scratch pad exists
    const existing = await this.getScratchPad(dealId);
    
    if (!existing) {
      // Create new scratch pad
      await this.prisma.$executeRaw`
        INSERT INTO scratch_pads (deal_id, title, content, content_type)
        VALUES (${dealId}, ${updateDto.title || 'Investment Analysis'}, 
                ${updateDto.content || ''}, ${updateDto.contentType || 'markdown'})
      `;
    } else {
      // Update existing scratch pad
      const updateFields: string[] = [];
      const values: any[] = [];

      if (updateDto.title !== undefined) {
        updateFields.push('title = $' + (values.length + 1));
        values.push(updateDto.title);
      }
      if (updateDto.content !== undefined) {
        updateFields.push('content = $' + (values.length + 1));
        values.push(updateDto.content);
      }
      if (updateDto.contentType !== undefined) {
        updateFields.push('content_type = $' + (values.length + 1));
        values.push(updateDto.contentType);
      }

      if (updateFields.length > 0) {
        updateFields.push('auto_saved_at = NOW()');
        values.push(dealId);

        const query = `UPDATE scratch_pads SET ${updateFields.join(', ')} WHERE deal_id = $${values.length}`;
        await this.prisma.$executeRawUnsafe(query, ...values.slice(0, -1), dealId);
      }
    }

    return this.getScratchPad(dealId);
  }

  /**
   * Manually save scratch pad (creates version)
   */
  async manuallySaveScratchPad(dealId: string): Promise<ScratchPad | null> {
    this.logger.log(`Manually saving scratch pad for deal: ${dealId}`);

    const existing = await this.getScratchPad(dealId);
    if (!existing) {
      throw new NotFoundException('Scratch pad not found');
    }

    // Update manually saved timestamp and increment version
    await this.prisma.$executeRaw`
      UPDATE scratch_pads 
      SET manually_saved_at = NOW(), version = version + 1
      WHERE deal_id = ${dealId}::uuid
    `;

    return this.getScratchPad(dealId);
  }

  /**
   * Generate investment memo template
   */
  async generateTemplate(dealId: string, templateType: 'basic' | 'detailed' | 'executive'): Promise<string> {
    this.logger.log(`Generating ${templateType} template for deal: ${dealId}`);

    // Get deal information
    const deals = await this.prisma.$queryRaw`
      SELECT name, description, deal_type, ticker, company_name, report_type, time_periods
      FROM deals
      WHERE id = ${dealId}::uuid
    ` as any[];

    if (!deals[0]) {
      throw new NotFoundException('Deal not found');
    }

    const deal = deals[0];

    const templates = {
      basic: this.generateBasicTemplate(deal),
      detailed: this.generateDetailedTemplate(deal),
      executive: this.generateExecutiveTemplate(deal),
    };

    return templates[templateType];
  }

  /**
   * Export scratch pad content
   */
  async exportScratchPad(dealId: string, format: 'markdown' | 'html' | 'plain'): Promise<{
    content: string;
    filename: string;
    mimeType: string;
  }> {
    const scratchPad = await this.getScratchPad(dealId);
    if (!scratchPad) {
      throw new NotFoundException('Scratch pad not found');
    }

    // Get deal name for filename
    const deals = await this.prisma.$queryRaw`
      SELECT name FROM deals WHERE id = ${dealId}::uuid
    ` as any[];

    const dealName = deals[0]?.name || 'Investment Analysis';
    const sanitizedName = dealName.replace(/[^a-zA-Z0-9]/g, '_');

    let content = scratchPad.content;
    let filename = `${sanitizedName}_memo`;
    let mimeType = 'text/plain';

    switch (format) {
      case 'markdown':
        filename += '.md';
        mimeType = 'text/markdown';
        break;
      case 'html':
        // Convert markdown to HTML if needed
        content = this.convertMarkdownToHtml(content);
        filename += '.html';
        mimeType = 'text/html';
        break;
      case 'plain':
        // Strip markdown formatting
        content = this.stripMarkdown(content);
        filename += '.txt';
        mimeType = 'text/plain';
        break;
    }

    return {
      content,
      filename,
      mimeType,
    };
  }

  /**
   * Get scratch pad history/versions
   */
  async getScratchPadHistory(dealId: string): Promise<Array<{
    version: number;
    autoSavedAt: Date;
    manuallySavedAt?: Date;
    contentPreview: string;
  }>> {
    // For now, we only keep the latest version
    // In the future, we could implement version history
    const scratchPad = await this.getScratchPad(dealId);
    
    if (!scratchPad) {
      return [];
    }

    return [{
      version: scratchPad.version,
      autoSavedAt: scratchPad.autoSavedAt,
      manuallySavedAt: scratchPad.manuallySavedAt,
      contentPreview: scratchPad.content.substring(0, 200) + (scratchPad.content.length > 200 ? '...' : ''),
    }];
  }

  /**
   * Generate basic investment memo template
   */
  private generateBasicTemplate(deal: any): string {
    return `# Investment Analysis: ${deal.company_name || deal.name}

## Executive Summary
*Brief overview of the investment opportunity*

## Company Overview
- **Company**: ${deal.company_name || 'TBD'}
- **Ticker**: ${deal.ticker || 'Private Company'}
- **Deal Type**: ${deal.deal_type}
- **Analysis Period**: ${deal.report_type} reports, last ${deal.time_periods} periods

## Key Findings
*Main insights from financial analysis*

## Financial Highlights
*Key metrics and trends*

## Investment Thesis
*Why this is a good/bad investment*

## Risks & Considerations
*Key risks and mitigation strategies*

## Recommendation
*Final recommendation with rationale*

---
*Generated on ${new Date().toLocaleDateString()}*
`;
  }

  /**
   * Generate detailed investment memo template
   */
  private generateDetailedTemplate(deal: any): string {
    return `# Detailed Investment Analysis: ${deal.company_name || deal.name}

## Executive Summary
*2-3 paragraph summary of key findings and recommendation*

## Investment Overview
- **Company**: ${deal.company_name || 'TBD'}
- **Ticker**: ${deal.ticker || 'Private Company'}
- **Deal Type**: ${deal.deal_type}
- **Analysis Period**: ${deal.report_type} reports, last ${deal.time_periods} periods
- **Date**: ${new Date().toLocaleDateString()}

## Business Analysis
### Company Description
*What does the company do?*

### Market Position
*Competitive landscape and market share*

### Business Model
*How does the company make money?*

## Financial Analysis
### Revenue Analysis
*Revenue trends, growth rates, seasonality*

### Profitability Analysis
*Margin analysis, cost structure*

### Balance Sheet Analysis
*Asset quality, debt levels, working capital*

### Cash Flow Analysis
*Operating cash flow, free cash flow, capital allocation*

### Key Financial Ratios
*ROE, ROA, debt ratios, efficiency metrics*

## Valuation Analysis
### Comparable Company Analysis
*Trading multiples vs peers*

### DCF Analysis
*Discounted cash flow valuation*

### Scenario Analysis
*Bull, base, bear case scenarios*

## Investment Thesis
### Strengths
*Key positive factors*

### Opportunities
*Growth drivers and catalysts*

## Risk Analysis
### Company-Specific Risks
*Operational, financial, management risks*

### Market Risks
*Industry, economic, regulatory risks*

### Mitigation Strategies
*How to address key risks*

## Recommendation
### Investment Decision
*Buy/Hold/Sell with rationale*

### Target Price/Valuation
*Fair value estimate*

### Timeline
*Investment horizon and milestones*

## Appendix
### Data Sources
*SEC filings, market data sources*

### Assumptions
*Key modeling assumptions*

---
*Analysis completed on ${new Date().toLocaleDateString()}*
`;
  }

  /**
   * Generate executive summary template
   */
  private generateExecutiveTemplate(deal: any): string {
    return `# Executive Summary: ${deal.company_name || deal.name}

**Investment Recommendation**: [BUY/HOLD/SELL]
**Target Price**: $[X.XX]
**Current Price**: $[X.XX]
**Upside/Downside**: [X]%

## Key Investment Points
1. **[Key Point 1]**: Brief description
2. **[Key Point 2]**: Brief description  
3. **[Key Point 3]**: Brief description

## Financial Snapshot
- **Revenue Growth**: [X]% (${deal.report_type})
- **Gross Margin**: [X]%
- **Operating Margin**: [X]%
- **ROE**: [X]%
- **Debt/Equity**: [X.X]x

## Investment Thesis
*2-3 sentences on why this is attractive*

## Key Risks
1. **[Risk 1]**: Brief description
2. **[Risk 2]**: Brief description

## Recommendation
*Final recommendation in 1-2 sentences*

---
**Analyst**: [Your Name]
**Date**: ${new Date().toLocaleDateString()}
`;
  }

  /**
   * Convert markdown to HTML (basic implementation)
   */
  private convertMarkdownToHtml(markdown: string): string {
    return markdown
      .replace(/^# (.*$)/gim, '<h1>$1</h1>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*)\*/gim, '<em>$1</em>')
      .replace(/\n/gim, '<br>');
  }

  /**
   * Strip markdown formatting
   */
  private stripMarkdown(markdown: string): string {
    return markdown
      .replace(/^#+\s/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1');
  }
}