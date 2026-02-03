import { Controller, Post, Get, Body, Query, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBody } from '@nestjs/swagger';
import { ChunkExporterService } from './chunk-exporter.service';

@ApiTags('Chunk Export')
@Controller('rag/chunks')
export class ChunkExportController {
  private readonly logger = new Logger(ChunkExportController.name);

  constructor(private readonly chunkExporter: ChunkExporterService) {}

  /**
   * Get export statistics
   */
  @Get('stats')
  @ApiOperation({ summary: 'Get chunk export statistics' })
  @ApiQuery({ name: 'ticker', required: false, example: 'AAPL' })
  async getStats(@Query('ticker') ticker?: string) {
    return this.chunkExporter.getExportStats(ticker);
  }

  /**
   * Export chunks to local JSON file
   */
  @Post('export-local')
  @ApiOperation({ summary: 'Export chunks to local JSON file for testing' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', example: 'AAPL' },
        outputPath: { type: 'string', example: './bedrock-chunks-test.json' },
        limit: { type: 'number', example: 50 },
      },
      required: ['outputPath'],
    },
  })
  async exportToLocal(@Body() body: {
    ticker?: string;
    outputPath: string;
    limit?: number;
  }) {
    try {
      const stats = await this.chunkExporter.exportToLocal(body);
      return {
        success: true,
        message: `Exported ${stats.validChunks} chunks to ${body.outputPath}`,
        stats,
      };
    } catch (error) {
      this.logger.error(`Export failed: ${error.message}`);
      return {
        success: false,
        message: `Export failed: ${error.message}`,
      };
    }
  }

  /**
   * Upload chunks to S3 for Bedrock Knowledge Base
   */
  @Post('upload-s3')
  @ApiOperation({ summary: 'Upload chunks to S3 for Bedrock Knowledge Base' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        bucket: { type: 'string', example: 'fundlens-chunks-prod' },
        ticker: { type: 'string', example: 'AAPL' },
        keyPrefix: { type: 'string', example: 'chunks' },
        dryRun: { type: 'boolean', example: true },
      },
      required: ['bucket'],
    },
  })
  async uploadToS3(@Body() body: {
    bucket: string;
    ticker?: string;
    keyPrefix?: string;
    dryRun?: boolean;
  }) {
    try {
      const result = await this.chunkExporter.uploadToS3(body);
      return {
        success: true,
        message: `${body.dryRun ? 'DRY RUN: Would upload' : 'Uploaded'} ${result.uploadedCount} chunks to S3`,
        result,
      };
    } catch (error) {
      this.logger.error(`S3 upload failed: ${error.message}`);
      return {
        success: false,
        message: `S3 upload failed: ${error.message}`,
      };
    }
  }

  /**
   * Validate chunks for Bedrock compatibility
   */
  @Post('validate')
  @ApiOperation({ summary: 'Validate chunks for Bedrock Knowledge Base compatibility' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', example: 'AAPL' },
        limit: { type: 'number', example: 100 },
      },
    },
  })
  async validateChunks(@Body() body: {
    ticker?: string;
    limit?: number;
  }) {
    try {
      const { chunks, stats } = await this.chunkExporter.exportChunksForBedrock({
        ticker: body.ticker,
        limit: body.limit,
        validateOnly: true,
      });

      const validationSummary = {
        totalChunks: stats.totalChunks,
        validChunks: stats.validChunks,
        invalidChunks: stats.invalidChunks,
        validationRate: stats.totalChunks > 0 ? (stats.validChunks / stats.totalChunks * 100).toFixed(1) + '%' : '0%',
        avgChunkSize: stats.validChunks > 0 ? Math.round(stats.totalSize / stats.validChunks) : 0,
        byTicker: stats.byTicker,
        bySectionType: stats.bySectionType,
      };

      return {
        success: true,
        message: `Validation complete: ${stats.validChunks}/${stats.totalChunks} chunks valid`,
        validation: validationSummary,
      };
    } catch (error) {
      this.logger.error(`Validation failed: ${error.message}`);
      return {
        success: false,
        message: `Validation failed: ${error.message}`,
      };
    }
  }
}