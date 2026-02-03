/**
 * Parsing Review Controller
 * 
 * Admin endpoints for human-in-the-loop review of SEC parsing edge cases.
 * 
 * Endpoints:
 * - GET /api/v1/internal/ops/parsing/unmapped-tags - List unmapped XBRL tags
 * - POST /api/v1/internal/ops/parsing/unmapped-tags/:id/map - Add mapping for tag
 * - POST /api/v1/internal/ops/parsing/unmapped-tags/:id/ignore - Ignore tag
 * - GET /api/v1/internal/ops/parsing/validation-failures - List validation failures
 * - POST /api/v1/internal/ops/parsing/validation-failures/:id/resolve - Resolve failure
 * - GET /api/v1/internal/ops/parsing/stats - Get queue statistics
 * 
 * Requirements: 8.4, 8.6, 12.2
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
} from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';
import {
  ParsingReviewService,
  UnmappedTagRecord,
  ValidationFailureRecord,
  AddMappingDto,
  ResolveValidationDto,
} from './parsing-review.service';

// Request DTOs
class AddMappingRequestDto {
  xbrlTag: string;
  normalizedMetric: string;
  displayName: string;
  statementType: 'income_statement' | 'balance_sheet' | 'cash_flow';
  notes?: string;
}

class IgnoreTagRequestDto {
  reason?: string;
}

class ResolveValidationRequestDto {
  resolution: 'data_corrected' | 'override_accepted' | 'acknowledged' | 'false_positive';
  notes?: string;
}

class RecordUnmappedTagsRequestDto {
  tags: Array<{
    xbrlTag: string;
    ticker: string;
    filingType: string;
    fiscalPeriod: string;
    statementType: string;
  }>;
}

class RecordValidationFailuresRequestDto {
  failures: Array<{
    ticker: string;
    filingType: string;
    fiscalPeriod: string;
    checkName: string;
    checkType: string;
    expectedValue: number;
    actualValue: number;
    differencePct: number;
  }>;
}

@Controller('v1/internal/ops/parsing')
@UseGuards(PlatformAdminGuard)
export class ParsingReviewController {
  private readonly logger = new Logger(ParsingReviewController.name);

  constructor(private readonly reviewService: ParsingReviewService) {}

  // ==================== UNMAPPED TAGS ====================

  /**
   * List unmapped XBRL tags sorted by frequency
   * GET /api/v1/internal/ops/parsing/unmapped-tags
   */
  @Get('unmapped-tags')
  async listUnmappedTags(
    @Query('status') status?: 'pending' | 'mapped' | 'ignored',
    @Query('statementType') statementType?: string,
    @Query('minOccurrences') minOccurrences?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{
    success: boolean;
    tags: UnmappedTagRecord[];
    total: number;
  }> {
    const result = await this.reviewService.listUnmappedTags({
      status,
      statementType,
      minOccurrences: minOccurrences ? parseInt(minOccurrences, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Add a mapping for an unmapped tag
   * POST /api/v1/internal/ops/parsing/unmapped-tags/:id/map
   */
  @Post('unmapped-tags/:id/map')
  @HttpCode(HttpStatus.OK)
  async addMapping(
    @Param('id') id: string,
    @Body() dto: AddMappingRequestDto,
    @Headers('x-admin-email') adminEmail?: string,
  ): Promise<{
    success: boolean;
    affectedFilings: string[];
    message: string;
  }> {
    this.logger.log(`Adding mapping for tag ${id}: ${dto.xbrlTag} -> ${dto.normalizedMetric}`);

    const result = await this.reviewService.addMapping(
      id,
      dto,
      adminEmail || 'admin@system',
    );

    return {
      success: true,
      affectedFilings: result.affectedFilings,
      message: `Mapping added. ${result.affectedFilings.length} filings queued for re-processing.`,
    };
  }

  /**
   * Ignore an unmapped tag
   * POST /api/v1/internal/ops/parsing/unmapped-tags/:id/ignore
   */
  @Post('unmapped-tags/:id/ignore')
  @HttpCode(HttpStatus.OK)
  async ignoreTag(
    @Param('id') id: string,
    @Body() dto: IgnoreTagRequestDto,
    @Headers('x-admin-email') adminEmail?: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Ignoring tag ${id}`);

    await this.reviewService.ignoreTag(id, adminEmail || 'admin@system', dto.reason);

    return {
      success: true,
      message: 'Tag marked as ignored',
    };
  }

  /**
   * Batch record unmapped tags (called by Python parser)
   * POST /api/v1/internal/ops/parsing/unmapped-tags/batch
   */
  @Post('unmapped-tags/batch')
  @HttpCode(HttpStatus.CREATED)
  async recordUnmappedTagsBatch(
    @Body() dto: RecordUnmappedTagsRequestDto,
  ): Promise<{
    success: boolean;
    recorded: number;
    updated: number;
  }> {
    const result = await this.reviewService.recordUnmappedTagsBatch(dto.tags);

    return {
      success: true,
      ...result,
    };
  }

  // ==================== VALIDATION FAILURES ====================

  /**
   * List validation failures for review
   * GET /api/v1/internal/ops/parsing/validation-failures
   */
  @Get('validation-failures')
  async listValidationFailures(
    @Query('status') status?: 'pending' | 'resolved' | 'overridden' | 'acknowledged',
    @Query('ticker') ticker?: string,
    @Query('checkType') checkType?: string,
    @Query('minDifferencePct') minDifferencePct?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{
    success: boolean;
    failures: ValidationFailureRecord[];
    total: number;
  }> {
    const result = await this.reviewService.listValidationFailures({
      status,
      ticker,
      checkType,
      minDifferencePct: minDifferencePct ? parseFloat(minDifferencePct) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    return {
      success: true,
      ...result,
    };
  }

  /**
   * Resolve a validation failure
   * POST /api/v1/internal/ops/parsing/validation-failures/:id/resolve
   */
  @Post('validation-failures/:id/resolve')
  @HttpCode(HttpStatus.OK)
  async resolveValidationFailure(
    @Param('id') id: string,
    @Body() dto: ResolveValidationRequestDto,
    @Headers('x-admin-email') adminEmail?: string,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log(`Resolving validation failure ${id}: ${dto.resolution}`);

    await this.reviewService.resolveValidationFailure(
      id,
      dto,
      adminEmail || 'admin@system',
    );

    return {
      success: true,
      message: 'Validation failure resolved',
    };
  }

  /**
   * Batch record validation failures (called by Python validator)
   * POST /api/v1/internal/ops/parsing/validation-failures/batch
   */
  @Post('validation-failures/batch')
  @HttpCode(HttpStatus.CREATED)
  async recordValidationFailuresBatch(
    @Body() dto: RecordValidationFailuresRequestDto,
  ): Promise<{
    success: boolean;
    recorded: number;
  }> {
    const result = await this.reviewService.recordValidationFailuresBatch(dto.failures);

    return {
      success: true,
      ...result,
    };
  }

  // ==================== STATISTICS ====================

  /**
   * Get review queue statistics
   * GET /api/v1/internal/ops/parsing/stats
   */
  @Get('stats')
  async getQueueStats(): Promise<{
    success: boolean;
    stats: {
      unmappedTags: { pending: number; mapped: number; ignored: number; total: number };
      validationFailures: { pending: number; resolved: number; overridden: number; total: number };
      reprocessingQueue: { pending: number; completed: number; failed: number };
    };
  }> {
    const stats = await this.reviewService.getQueueStats();

    return {
      success: true,
      stats,
    };
  }
}
