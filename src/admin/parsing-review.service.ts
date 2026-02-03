/**
 * Parsing Review Service
 * 
 * Human-in-the-loop workflow for SEC parsing edge cases.
 * Manages review queues for:
 * - Unmapped XBRL tags
 * - Validation failures
 * - Mapping updates
 * 
 * Requirements: 8.4, 8.6, 12.2
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// ============ DTOs ============

export interface UnmappedTagRecord {
  id: string;
  xbrlTag: string;
  ticker: string;
  filingType: string;
  fiscalPeriod: string;
  statementType: string;
  occurrenceCount: number;
  firstSeen: Date;
  lastSeen: Date;
  status: 'pending' | 'mapped' | 'ignored';
  suggestedMapping?: string;
  mappedBy?: string;
  mappedAt?: Date;
  notes?: string;
}

export interface ValidationFailureRecord {
  id: string;
  ticker: string;
  filingType: string;
  fiscalPeriod: string;
  checkName: string;
  checkType: string;
  expectedValue: number;
  actualValue: number;
  differencePct: number;
  status: 'pending' | 'resolved' | 'overridden' | 'acknowledged';
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

export interface MappingVersion {
  id: string;
  version: string;
  createdAt: Date;
  createdBy: string;
  changes: MappingChange[];
  affectedFilings: string[];
}

export interface MappingChange {
  xbrlTag: string;
  normalizedMetric: string;
  statementType: string;
  action: 'add' | 'update' | 'remove';
}

export interface AddMappingDto {
  xbrlTag: string;
  normalizedMetric: string;
  displayName: string;
  statementType: 'income_statement' | 'balance_sheet' | 'cash_flow';
  notes?: string;
}

export interface ResolveValidationDto {
  resolution: 'data_corrected' | 'override_accepted' | 'acknowledged' | 'false_positive';
  notes?: string;
}

// ============ Service ============

@Injectable()
export class ParsingReviewService {
  private readonly logger = new Logger(ParsingReviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==================== UNMAPPED TAG QUEUE ====================

  /**
   * Record an unmapped XBRL tag for review
   * Called by the Python parser when encountering unknown tags
   * 
   * Implements Requirement 8.4: Track unmapped tags
   */
  async recordUnmappedTag(
    xbrlTag: string,
    ticker: string,
    filingType: string,
    fiscalPeriod: string,
    statementType: string,
  ): Promise<void> {
    this.logger.debug(`Recording unmapped tag: ${xbrlTag} from ${ticker}`);

    // Check if tag already exists
    const existing = await this.prisma.unmappedXbrlTag.findFirst({
      where: { xbrlTag },
    });

    if (existing) {
      // Update occurrence count and last seen
      await this.prisma.unmappedXbrlTag.update({
        where: { id: existing.id },
        data: {
          occurrenceCount: { increment: 1 },
          lastSeen: new Date(),
          // Add ticker to list if not already present
          tickers: existing.tickers.includes(ticker)
            ? existing.tickers
            : [...existing.tickers, ticker],
        },
      });
    } else {
      // Create new record
      await this.prisma.unmappedXbrlTag.create({
        data: {
          xbrlTag,
          tickers: [ticker],
          filingTypes: [filingType],
          statementType,
          occurrenceCount: 1,
          firstSeen: new Date(),
          lastSeen: new Date(),
          status: 'pending',
        },
      });
    }
  }

  /**
   * Batch record unmapped tags from a parsing run
   */
  async recordUnmappedTagsBatch(
    tags: Array<{
      xbrlTag: string;
      ticker: string;
      filingType: string;
      fiscalPeriod: string;
      statementType: string;
    }>,
  ): Promise<{ recorded: number; updated: number }> {
    let recorded = 0;
    let updated = 0;

    for (const tag of tags) {
      const existing = await this.prisma.unmappedXbrlTag.findFirst({
        where: { xbrlTag: tag.xbrlTag },
      });

      if (existing) {
        await this.prisma.unmappedXbrlTag.update({
          where: { id: existing.id },
          data: {
            occurrenceCount: { increment: 1 },
            lastSeen: new Date(),
            tickers: existing.tickers.includes(tag.ticker)
              ? existing.tickers
              : [...existing.tickers, tag.ticker],
          },
        });
        updated++;
      } else {
        await this.prisma.unmappedXbrlTag.create({
          data: {
            xbrlTag: tag.xbrlTag,
            tickers: [tag.ticker],
            filingTypes: [tag.filingType],
            statementType: tag.statementType,
            occurrenceCount: 1,
            firstSeen: new Date(),
            lastSeen: new Date(),
            status: 'pending',
          },
        });
        recorded++;
      }
    }

    this.logger.log(`Recorded ${recorded} new tags, updated ${updated} existing`);
    return { recorded, updated };
  }

  /**
   * List unmapped tags sorted by frequency
   * 
   * Implements Requirement 8.4: Admin endpoint to list unmapped tags
   */
  async listUnmappedTags(options?: {
    status?: 'pending' | 'mapped' | 'ignored';
    statementType?: string;
    minOccurrences?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ tags: UnmappedTagRecord[]; total: number }> {
    const where: any = {};

    if (options?.status) {
      where.status = options.status;
    }
    if (options?.statementType) {
      where.statementType = options.statementType;
    }
    if (options?.minOccurrences) {
      where.occurrenceCount = { gte: options.minOccurrences };
    }

    const [tags, total] = await Promise.all([
      this.prisma.unmappedXbrlTag.findMany({
        where,
        orderBy: { occurrenceCount: 'desc' },
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.unmappedXbrlTag.count({ where }),
    ]);

    return {
      tags: tags.map((t) => ({
        id: t.id,
        xbrlTag: t.xbrlTag,
        ticker: t.tickers[0] || '',
        filingType: t.filingTypes[0] || '',
        fiscalPeriod: '',
        statementType: t.statementType,
        occurrenceCount: t.occurrenceCount,
        firstSeen: t.firstSeen,
        lastSeen: t.lastSeen,
        status: t.status as 'pending' | 'mapped' | 'ignored',
        suggestedMapping: t.suggestedMapping || undefined,
        mappedBy: t.mappedBy || undefined,
        mappedAt: t.mappedAt || undefined,
        notes: t.notes || undefined,
      })),
      total,
    };
  }

  /**
   * Add a new mapping for an unmapped tag
   * 
   * Implements Requirement 8.6: Manual mapping addition
   */
  async addMapping(
    tagId: string,
    dto: AddMappingDto,
    adminEmail: string,
  ): Promise<{ success: boolean; affectedFilings: string[] }> {
    this.logger.log(`Adding mapping for tag ${tagId}: ${dto.xbrlTag} -> ${dto.normalizedMetric}`);

    // Get the unmapped tag record
    const tag = await this.prisma.unmappedXbrlTag.findUnique({
      where: { id: tagId },
    });

    if (!tag) {
      throw new NotFoundException('Unmapped tag not found');
    }

    // Create mapping record
    await this.prisma.xbrlTagMapping.create({
      data: {
        xbrlTag: dto.xbrlTag,
        normalizedMetric: dto.normalizedMetric,
        displayName: dto.displayName,
        statementType: dto.statementType,
        source: 'manual',
        createdBy: adminEmail,
        version: await this.getNextMappingVersion(),
      },
    });

    // Update unmapped tag status
    await this.prisma.unmappedXbrlTag.update({
      where: { id: tagId },
      data: {
        status: 'mapped',
        suggestedMapping: dto.normalizedMetric,
        mappedBy: adminEmail,
        mappedAt: new Date(),
        notes: dto.notes,
      },
    });

    // Find affected filings that need re-processing
    const affectedFilings = tag.tickers.map((t) => `${t}:${tag.filingTypes[0]}`);

    // Queue re-processing (would trigger async job)
    await this.queueReprocessing(affectedFilings, dto.xbrlTag);

    this.logger.log(`Mapping added. ${affectedFilings.length} filings queued for re-processing`);

    return {
      success: true,
      affectedFilings,
    };
  }

  /**
   * Ignore an unmapped tag (mark as not needed)
   */
  async ignoreTag(tagId: string, adminEmail: string, reason?: string): Promise<void> {
    await this.prisma.unmappedXbrlTag.update({
      where: { id: tagId },
      data: {
        status: 'ignored',
        mappedBy: adminEmail,
        mappedAt: new Date(),
        notes: reason || 'Marked as not needed',
      },
    });

    this.logger.log(`Tag ${tagId} marked as ignored by ${adminEmail}`);
  }

  // ==================== VALIDATION FAILURE QUEUE ====================

  /**
   * Record a validation failure for review
   * 
   * Implements Requirement 12.2: Store validation failures
   */
  async recordValidationFailure(
    ticker: string,
    filingType: string,
    fiscalPeriod: string,
    checkName: string,
    checkType: string,
    expectedValue: number,
    actualValue: number,
    differencePct: number,
  ): Promise<void> {
    this.logger.debug(`Recording validation failure: ${checkName} for ${ticker}`);

    // Check for existing failure (avoid duplicates)
    const existing = await this.prisma.validationFailure.findFirst({
      where: {
        ticker,
        filingType,
        fiscalPeriod,
        checkName,
        status: 'pending',
      },
    });

    if (!existing) {
      await this.prisma.validationFailure.create({
        data: {
          ticker,
          filingType,
          fiscalPeriod,
          checkName,
          checkType,
          expectedValue,
          actualValue,
          differencePct,
          status: 'pending',
        },
      });
    }
  }

  /**
   * Batch record validation failures
   */
  async recordValidationFailuresBatch(
    failures: Array<{
      ticker: string;
      filingType: string;
      fiscalPeriod: string;
      checkName: string;
      checkType: string;
      expectedValue: number;
      actualValue: number;
      differencePct: number;
    }>,
  ): Promise<{ recorded: number }> {
    let recorded = 0;

    for (const failure of failures) {
      const existing = await this.prisma.validationFailure.findFirst({
        where: {
          ticker: failure.ticker,
          filingType: failure.filingType,
          fiscalPeriod: failure.fiscalPeriod,
          checkName: failure.checkName,
          status: 'pending',
        },
      });

      if (!existing) {
        await this.prisma.validationFailure.create({
          data: failure,
        });
        recorded++;
      }
    }

    this.logger.log(`Recorded ${recorded} validation failures`);
    return { recorded };
  }

  /**
   * List validation failures for review
   * 
   * Implements Requirement 12.2: Admin endpoint to review failures
   */
  async listValidationFailures(options?: {
    status?: 'pending' | 'resolved' | 'overridden' | 'acknowledged';
    ticker?: string;
    checkType?: string;
    minDifferencePct?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ failures: ValidationFailureRecord[]; total: number }> {
    const where: any = {};

    if (options?.status) {
      where.status = options.status;
    }
    if (options?.ticker) {
      where.ticker = options.ticker;
    }
    if (options?.checkType) {
      where.checkType = options.checkType;
    }
    if (options?.minDifferencePct) {
      where.differencePct = { gte: options.minDifferencePct };
    }

    const [failures, total] = await Promise.all([
      this.prisma.validationFailure.findMany({
        where,
        orderBy: [{ differencePct: 'desc' }, { createdAt: 'desc' }],
        take: options?.limit || 50,
        skip: options?.offset || 0,
      }),
      this.prisma.validationFailure.count({ where }),
    ]);

    return {
      failures: failures.map((f) => ({
        id: f.id,
        ticker: f.ticker,
        filingType: f.filingType,
        fiscalPeriod: f.fiscalPeriod,
        checkName: f.checkName,
        checkType: f.checkType,
        expectedValue: f.expectedValue.toNumber(),
        actualValue: f.actualValue.toNumber(),
        differencePct: f.differencePct,
        status: f.status as 'pending' | 'resolved' | 'overridden' | 'acknowledged',
        resolution: f.resolution || undefined,
        resolvedBy: f.resolvedBy || undefined,
        resolvedAt: f.resolvedAt || undefined,
        createdAt: f.createdAt,
      })),
      total,
    };
  }

  /**
   * Resolve a validation failure
   * 
   * Implements Requirement 12.2: Manual override with audit trail
   */
  async resolveValidationFailure(
    failureId: string,
    dto: ResolveValidationDto,
    adminEmail: string,
  ): Promise<void> {
    this.logger.log(`Resolving validation failure ${failureId}: ${dto.resolution}`);

    const failure = await this.prisma.validationFailure.findUnique({
      where: { id: failureId },
    });

    if (!failure) {
      throw new NotFoundException('Validation failure not found');
    }

    const statusMap: Record<string, string> = {
      data_corrected: 'resolved',
      override_accepted: 'overridden',
      acknowledged: 'acknowledged',
      false_positive: 'resolved',
    };

    await this.prisma.validationFailure.update({
      where: { id: failureId },
      data: {
        status: statusMap[dto.resolution] || 'resolved',
        resolution: `${dto.resolution}${dto.notes ? ': ' + dto.notes : ''}`,
        resolvedBy: adminEmail,
        resolvedAt: new Date(),
      },
    });

    // Log audit trail
    await this.logAuditEvent('validation_failure_resolved', {
      failureId,
      resolution: dto.resolution,
      notes: dto.notes,
      adminEmail,
      ticker: failure.ticker,
      checkName: failure.checkName,
    });

    this.logger.log(`Validation failure ${failureId} resolved by ${adminEmail}`);
  }

  // ==================== MAPPING VERSION TRACKING ====================

  /**
   * Get the next mapping version number
   * 
   * Implements Requirement 8.6: Track mapping version
   */
  private async getNextMappingVersion(): Promise<string> {
    const latest = await this.prisma.xbrlTagMapping.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { version: true },
    });

    if (!latest?.version) {
      return '1.0.0';
    }

    // Increment patch version
    const parts = latest.version.split('.');
    const patch = parseInt(parts[2] || '0', 10) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  /**
   * Queue filings for re-processing after mapping update
   * 
   * Implements Requirement 8.6: Re-process affected filings
   */
  private async queueReprocessing(
    filings: string[],
    xbrlTag: string,
  ): Promise<void> {
    // In a real implementation, this would add to a job queue
    // For now, we log and store the request
    this.logger.log(`Queuing ${filings.length} filings for re-processing due to new mapping: ${xbrlTag}`);

    await this.prisma.reprocessingQueue.createMany({
      data: filings.map((f) => {
        const [ticker, filingType] = f.split(':');
        return {
          ticker,
          filingType,
          reason: `New mapping added: ${xbrlTag}`,
          status: 'pending',
        };
      }),
      skipDuplicates: true,
    });
  }

  /**
   * Log audit event for compliance
   */
  private async logAuditEvent(
    eventType: string,
    details: Record<string, any>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        eventType,
        details,
        timestamp: new Date(),
      },
    });
  }

  // ==================== STATISTICS ====================

  /**
   * Get review queue statistics
   */
  async getQueueStats(): Promise<{
    unmappedTags: { pending: number; mapped: number; ignored: number; total: number };
    validationFailures: { pending: number; resolved: number; overridden: number; total: number };
    reprocessingQueue: { pending: number; completed: number; failed: number };
  }> {
    const [
      unmappedPending,
      unmappedMapped,
      unmappedIgnored,
      validationPending,
      validationResolved,
      validationOverridden,
      reprocessPending,
      reprocessCompleted,
      reprocessFailed,
    ] = await Promise.all([
      this.prisma.unmappedXbrlTag.count({ where: { status: 'pending' } }),
      this.prisma.unmappedXbrlTag.count({ where: { status: 'mapped' } }),
      this.prisma.unmappedXbrlTag.count({ where: { status: 'ignored' } }),
      this.prisma.validationFailure.count({ where: { status: 'pending' } }),
      this.prisma.validationFailure.count({ where: { status: 'resolved' } }),
      this.prisma.validationFailure.count({ where: { status: 'overridden' } }),
      this.prisma.reprocessingQueue.count({ where: { status: 'pending' } }),
      this.prisma.reprocessingQueue.count({ where: { status: 'completed' } }),
      this.prisma.reprocessingQueue.count({ where: { status: 'failed' } }),
    ]);

    return {
      unmappedTags: {
        pending: unmappedPending,
        mapped: unmappedMapped,
        ignored: unmappedIgnored,
        total: unmappedPending + unmappedMapped + unmappedIgnored,
      },
      validationFailures: {
        pending: validationPending,
        resolved: validationResolved,
        overridden: validationOverridden,
        total: validationPending + validationResolved + validationOverridden,
      },
      reprocessingQueue: {
        pending: reprocessPending,
        completed: reprocessCompleted,
        failed: reprocessFailed,
      },
    };
  }
}
