import { Controller, Get, Post, Query, Logger } from '@nestjs/common';
import { SectionExporterService, SectionExportStats } from './section-exporter.service';

/**
 * Section Export Controller
 * 
 * Endpoints for managing section-based exports to S3 for Bedrock KB.
 * This optimized approach aggregates chunks by section before upload,
 * reducing S3 file count from ~77K to ~1K while preserving all content.
 */
@Controller('rag/sections')
export class SectionExportController {
  private readonly logger = new Logger(SectionExportController.name);

  constructor(private readonly sectionExporter: SectionExporterService) {}

  /**
   * Get list of tickers with narrative chunks
   */
  @Get('tickers')
  async getTickers(): Promise<{ tickers: string[]; count: number }> {
    const tickers = await this.sectionExporter.getTickersWithChunks();
    return { tickers, count: tickers.length };
  }

  /**
   * Preview section aggregation for a ticker (dry run)
   */
  @Get('preview')
  async previewSections(
    @Query('ticker') ticker: string,
  ): Promise<{
    ticker: string;
    sections: Array<{
      key: string;
      metadata: any;
      contentPreview: string;
    }>;
    totalSections: number;
    totalCharacters: number;
  }> {
    if (!ticker) {
      throw new Error('ticker query parameter is required');
    }

    const sections = await this.sectionExporter.aggregateChunksBySection(ticker);
    
    return {
      ticker,
      sections: sections.map(s => ({
        key: s.key,
        metadata: s.metadata,
        contentPreview: s.content.substring(0, 500) + (s.content.length > 500 ? '...' : ''),
      })),
      totalSections: sections.length,
      totalCharacters: sections.reduce((sum, s) => sum + s.content.length, 0),
    };
  }

  /**
   * Export sections for a single ticker to S3
   */
  @Post('export')
  async exportTickerSections(
    @Query('ticker') ticker: string,
    @Query('dryRun') dryRun?: string,
  ): Promise<SectionExportStats> {
    if (!ticker) {
      throw new Error('ticker query parameter is required');
    }

    this.logger.log(`Exporting sections for ${ticker} (dryRun: ${dryRun === 'true'})`);
    return this.sectionExporter.exportTickerSections(ticker, { dryRun: dryRun === 'true' });
  }

  /**
   * Export all sections for all tickers to S3
   */
  @Post('export-all')
  async exportAllSections(
    @Query('dryRun') dryRun?: string,
    @Query('clearExisting') clearExisting?: string,
    @Query('tickers') tickers?: string,
  ): Promise<{
    totalTickers: number;
    totalSections: number;
    totalCharacters: number;
    tickerStats: SectionExportStats[];
  }> {
    const tickerList = tickers ? tickers.split(',').map(t => t.trim()) : undefined;
    
    this.logger.log(`Exporting all sections (dryRun: ${dryRun === 'true'}, clearExisting: ${clearExisting === 'true'})`);
    
    return this.sectionExporter.exportAllSections({
      dryRun: dryRun === 'true',
      clearExisting: clearExisting === 'true',
      tickers: tickerList,
    });
  }

  /**
   * Clear existing section files from S3
   */
  @Post('clear')
  async clearSections(): Promise<{ deletedCount: number }> {
    this.logger.log('Clearing existing sections from S3');
    const deletedCount = await this.sectionExporter.clearExistingSections();
    return { deletedCount };
  }

  /**
   * Get current section count in S3
   */
  @Get('count')
  async getSectionCount(): Promise<{ count: number }> {
    const count = await this.sectionExporter.getS3SectionCount();
    return { count };
  }
}
