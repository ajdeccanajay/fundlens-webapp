import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { TenantGuard } from '../tenant/tenant.guard';
import { ExportService } from './export.service';
import {
  StatementType,
  FilingType,
  ExportMode,
} from './export.types';
import type {
  ExportRequest,
  Export8KRequest,
  AvailablePeriodsResponse,
  MetricDefinition,
  MetricRow,
  StatementData,
  ExportOptions,
  WorksheetOptions,
} from './export.types';

// Re-export types for convenience
export {
  StatementType,
  FilingType,
  ExportMode,
} from './export.types';

export type {
  ExportRequest,
  Export8KRequest,
  AvailablePeriodsResponse,
  MetricDefinition,
  MetricRow,
  StatementData,
  ExportOptions,
  WorksheetOptions,
} from './export.types';

@Controller('deals')
@UseGuards(TenantGuard)
@ApiTags('Financial Statement Exports')
export class ExportController {
  private readonly logger = new Logger(ExportController.name);

  constructor(private readonly exportService: ExportService) {}

  /**
   * Export by ticker (for comprehensive-financial-analysis.html)
   * POST /api/deals/export/by-ticker/:ticker/excel
   * 
   * Task 16.5: API Documentation
   * Exports financial statements to Excel format for a given ticker symbol.
   * Supports 10-K (annual), 10-Q (quarterly), and 8-K (current) filings.
   * Uses industry-specific templates based on GICS sector classification.
   */
  @Post('export/by-ticker/:ticker/excel')
  @ApiOperation({
    summary: 'Export financial statements to Excel by ticker',
    description: `
      Generates an Excel workbook containing financial statements for the specified ticker.
      
      **Features:**
      - Industry-specific templates (11 GICS sectors)
      - Multi-year/multi-period support
      - Automatic industry detection
      - SEC 10-K structure matching
      
      **Supported Filing Types:**
      - 10-K: Annual reports
      - 10-Q: Quarterly reports
      - 8-K: Current reports
      
      **Statement Types:**
      - INCOME_STATEMENT: Income statement / P&L
      - BALANCE_SHEET: Balance sheet / Statement of financial position
      - CASH_FLOW: Cash flow statement
    `,
  })
  @ApiParam({
    name: 'ticker',
    description: 'Stock ticker symbol (e.g., AAPL, JPM, AMZN)',
    example: 'AAPL',
  })
  @ApiBody({
    description: 'Export request configuration',
    schema: {
      type: 'object',
      required: ['filingType', 'years', 'statements'],
      properties: {
        filingType: {
          type: 'string',
          enum: ['10-K', '10-Q', '8-K'],
          description: 'Type of SEC filing',
          example: '10-K',
        },
        years: {
          type: 'array',
          items: { type: 'number' },
          description: 'Fiscal years to include',
          example: [2024, 2023, 2022],
        },
        statements: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW'],
          },
          description: 'Financial statement types to include',
          example: ['INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW'],
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Excel file generated successfully',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request parameters',
  })
  @ApiResponse({
    status: 404,
    description: 'Ticker not found or no data available',
  })
  async exportByTickerToExcel(
    @Param('ticker') ticker: string,
    @Body() request: ExportRequest,
    @Res() response: Response,
  ): Promise<void> {
    this.logger.log(`Export by ticker request for ${ticker}: ${JSON.stringify(request)}`);

    // Ensure years are strings (frontend might send numbers)
    if (request.years) {
      request.years = request.years.map(y => String(y));
    }
    if (request.quarters) {
      request.quarters = request.quarters.map(q => String(q));
    }

    // Validate request
    if (!request.filingType || !Object.values(FilingType).includes(request.filingType)) {
      throw new HttpException(
        'Invalid filing type. Must be 10-K, 10-Q, or 8-K',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!request.years || request.years.length === 0) {
      throw new HttpException(
        'At least one year must be selected',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!request.statements || request.statements.length === 0) {
      throw new HttpException(
        'At least one statement type must be selected',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate statement types
    for (const stmt of request.statements) {
      if (!Object.values(StatementType).includes(stmt)) {
        throw new HttpException(
          `Invalid statement type: ${stmt}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    try {
      const result = await this.exportService.generateExcelExportByTicker(ticker, request);

      // Set response headers for Excel download
      const filename = result.filename;
      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      response.setHeader('Content-Length', result.buffer.length);

      response.send(result.buffer);
    } catch (error) {
      this.logger.error(`Export by ticker failed: ${error.message}`, error.stack);

      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error.message || '';

      // User-friendly error messages - check for any "not found" or "No" patterns
      if (errorMessage.toLowerCase().includes('not found') ||
          errorMessage.toLowerCase().includes('no ') ||
          errorMessage.includes('filings found') ||
          errorMessage.includes('data found')) {
        throw new HttpException(
          errorMessage,
          HttpStatus.NOT_FOUND,
        );
      }

      // Generic error with helpful message
      throw new HttpException(
        'Failed to generate export file. Please verify the ticker symbol and try again. Contact support if this issue persists.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get available periods by ticker (for comprehensive-financial-analysis.html)
   * GET /api/deals/export/by-ticker/:ticker/available-periods
   */
  @Get('export/by-ticker/:ticker/available-periods')
  async getAvailablePeriodsByTicker(
    @Param('ticker') ticker: string,
  ): Promise<AvailablePeriodsResponse> {
    this.logger.log(`Getting available periods for ticker ${ticker}`);

    try {
      return await this.exportService.getAvailablePeriodsByTicker(ticker);
    } catch (error) {
      this.logger.error(`Failed to get available periods by ticker: ${error.message}`);

      throw new HttpException(
        'Failed to retrieve available periods',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Export 8-K filings by ticker (for comprehensive-financial-analysis.html)
   * POST /api/deals/export/by-ticker/:ticker/8k
   */
  @Post('export/by-ticker/:ticker/8k')
  async export8KByTicker(
    @Param('ticker') ticker: string,
    @Body() request: Export8KRequest,
    @Res() response: Response,
  ): Promise<void> {
    this.logger.log(`8-K export by ticker request for ${ticker}: ${JSON.stringify(request)}`);

    if (!request.startDate || !request.endDate) {
      throw new HttpException(
        'Start date and end date are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.exportService.generate8KExportByTicker(ticker, request);

      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      response.setHeader('Content-Length', result.buffer.length);

      response.send(result.buffer);
    } catch (error) {
      this.logger.error(`8-K export by ticker failed: ${error.message}`, error.stack);

      if (error instanceof HttpException) {
        throw error;
      }

      if (error.message?.includes('No 8-K')) {
        throw new HttpException(
          'No 8-K filings found in the specified date range',
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        'Failed to generate 8-K export',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/export/excel')
  async exportToExcel(
    @Param('id') dealId: string,
    @Body() request: ExportRequest,
    @Res() response: Response,
  ): Promise<void> {
    this.logger.log(`Export request for deal ${dealId}: ${JSON.stringify(request)}`);

    // Validate request
    if (!request.filingType || !Object.values(FilingType).includes(request.filingType)) {
      throw new HttpException(
        'Invalid filing type. Must be 10-K, 10-Q, or 8-K',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!request.years || request.years.length === 0) {
      throw new HttpException(
        'At least one year must be selected',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!request.statements || request.statements.length === 0) {
      throw new HttpException(
        'At least one statement type must be selected',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validate statement types
    for (const stmt of request.statements) {
      if (!Object.values(StatementType).includes(stmt)) {
        throw new HttpException(
          `Invalid statement type: ${stmt}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    try {
      const result = await this.exportService.generateExcelExport(dealId, request);

      // Set response headers for Excel download
      const filename = result.filename;
      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`,
      );
      response.setHeader('Content-Length', result.buffer.length);

      response.send(result.buffer);
    } catch (error) {
      this.logger.error(`Export failed: ${error.message}`, error.stack);

      if (error instanceof HttpException) {
        throw error;
      }

      if (error.message?.includes('not found') || error.message?.includes('No deal')) {
        throw new HttpException('Deal not found', HttpStatus.NOT_FOUND);
      }

      if (error.message?.includes('No data') || error.message?.includes('No metrics')) {
        throw new HttpException(
          'No financial data available for the selected periods',
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        'Failed to generate export file',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id/export/available-periods')
  async getAvailablePeriods(
    @Param('id') dealId: string,
  ): Promise<AvailablePeriodsResponse> {
    this.logger.log(`Getting available periods for deal ${dealId}`);

    try {
      return await this.exportService.getAvailablePeriods(dealId);
    } catch (error) {
      this.logger.error(`Failed to get available periods: ${error.message}`);

      if (error.message?.includes('not found') || error.message?.includes('No deal')) {
        throw new HttpException('Deal not found', HttpStatus.NOT_FOUND);
      }

      throw new HttpException(
        'Failed to retrieve available periods',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(':id/export/8k')
  async export8KFilings(
    @Param('id') dealId: string,
    @Body() request: Export8KRequest,
    @Res() response: Response,
  ): Promise<void> {
    this.logger.log(`8-K export request for deal ${dealId}: ${JSON.stringify(request)}`);

    if (!request.startDate || !request.endDate) {
      throw new HttpException(
        'Start date and end date are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.exportService.generate8KExport(dealId, request);

      response.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      response.setHeader(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      response.setHeader('Content-Length', result.buffer.length);

      response.send(result.buffer);
    } catch (error) {
      this.logger.error(`8-K export failed: ${error.message}`, error.stack);

      if (error instanceof HttpException) {
        throw error;
      }

      if (error.message?.includes('No 8-K')) {
        throw new HttpException(
          'No 8-K filings found in the specified date range',
          HttpStatus.NOT_FOUND,
        );
      }

      throw new HttpException(
        'Failed to generate 8-K export',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
