/**
 * Parsing Review Service Tests
 * 
 * Tests for human-in-the-loop workflow for SEC parsing edge cases.
 * Requirements: 8.4, 8.6, 12.2
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ParsingReviewService } from '../../src/admin/parsing-review.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

describe('ParsingReviewService', () => {
  let service: ParsingReviewService;
  let prisma: any;

  // Mock data
  const mockUnmappedTag = {
    id: 'tag-1',
    xbrlTag: 'cmcsa:ProgrammingAndProduction',
    tickers: ['CMCSA'],
    filingTypes: ['10-K'],
    statementType: 'income_statement',
    occurrenceCount: 5,
    firstSeen: new Date('2024-01-01'),
    lastSeen: new Date('2024-06-01'),
    status: 'pending',
    suggestedMapping: null,
    mappedBy: null,
    mappedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockValidationFailure = {
    id: 'failure-1',
    ticker: 'AAPL',
    filingType: '10-K',
    fiscalPeriod: 'FY2024',
    checkName: 'Total Assets = Current + Non-Current Assets',
    checkType: 'mathematical',
    expectedValue: { toNumber: () => 1000000 },
    actualValue: { toNumber: () => 950000 },
    differencePct: 5.0,
    status: 'pending',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    prisma = {
      unmappedXbrlTag: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      xbrlTagMapping: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      validationFailure: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      reprocessingQueue: {
        createMany: jest.fn(),
        count: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParsingReviewService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ParsingReviewService>(ParsingReviewService);
  });

  describe('recordUnmappedTag', () => {
    it('should create new unmapped tag record', async () => {
      prisma.unmappedXbrlTag.findFirst.mockResolvedValue(null);
      prisma.unmappedXbrlTag.create.mockResolvedValue(mockUnmappedTag);

      await service.recordUnmappedTag(
        'cmcsa:ProgrammingAndProduction',
        'CMCSA',
        '10-K',
        'FY2024',
        'income_statement',
      );

      expect(prisma.unmappedXbrlTag.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          xbrlTag: 'cmcsa:ProgrammingAndProduction',
          tickers: ['CMCSA'],
          filingTypes: ['10-K'],
          statementType: 'income_statement',
          occurrenceCount: 1,
          status: 'pending',
        }),
      });
    });

    it('should update existing unmapped tag record', async () => {
      prisma.unmappedXbrlTag.findFirst.mockResolvedValue(mockUnmappedTag);
      prisma.unmappedXbrlTag.update.mockResolvedValue({
        ...mockUnmappedTag,
        occurrenceCount: 6,
      });

      await service.recordUnmappedTag(
        'cmcsa:ProgrammingAndProduction',
        'CMCSA',
        '10-K',
        'FY2024',
        'income_statement',
      );

      expect(prisma.unmappedXbrlTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: expect.objectContaining({
          occurrenceCount: { increment: 1 },
        }),
      });
    });

    it('should add new ticker to existing tag', async () => {
      prisma.unmappedXbrlTag.findFirst.mockResolvedValue(mockUnmappedTag);
      prisma.unmappedXbrlTag.update.mockResolvedValue({
        ...mockUnmappedTag,
        tickers: ['CMCSA', 'DIS'],
      });

      await service.recordUnmappedTag(
        'cmcsa:ProgrammingAndProduction',
        'DIS',
        '10-K',
        'FY2024',
        'income_statement',
      );

      expect(prisma.unmappedXbrlTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: expect.objectContaining({
          tickers: ['CMCSA', 'DIS'],
        }),
      });
    });
  });

  describe('recordUnmappedTagsBatch', () => {
    it('should record multiple tags in batch', async () => {
      prisma.unmappedXbrlTag.findFirst.mockResolvedValue(null);
      prisma.unmappedXbrlTag.create.mockResolvedValue(mockUnmappedTag);

      const tags = [
        { xbrlTag: 'tag1', ticker: 'AAPL', filingType: '10-K', fiscalPeriod: 'FY2024', statementType: 'income_statement' },
        { xbrlTag: 'tag2', ticker: 'MSFT', filingType: '10-K', fiscalPeriod: 'FY2024', statementType: 'balance_sheet' },
      ];

      const result = await service.recordUnmappedTagsBatch(tags);

      expect(result.recorded).toBe(2);
      expect(result.updated).toBe(0);
      expect(prisma.unmappedXbrlTag.create).toHaveBeenCalledTimes(2);
    });

    it('should update existing tags in batch', async () => {
      prisma.unmappedXbrlTag.findFirst.mockResolvedValue(mockUnmappedTag);
      prisma.unmappedXbrlTag.update.mockResolvedValue(mockUnmappedTag);

      const tags = [
        { xbrlTag: 'cmcsa:ProgrammingAndProduction', ticker: 'CMCSA', filingType: '10-K', fiscalPeriod: 'FY2024', statementType: 'income_statement' },
      ];

      const result = await service.recordUnmappedTagsBatch(tags);

      expect(result.recorded).toBe(0);
      expect(result.updated).toBe(1);
    });
  });

  describe('listUnmappedTags', () => {
    it('should list unmapped tags sorted by frequency', async () => {
      prisma.unmappedXbrlTag.findMany.mockResolvedValue([mockUnmappedTag]);
      prisma.unmappedXbrlTag.count.mockResolvedValue(1);

      const result = await service.listUnmappedTags({ status: 'pending' });

      expect(result.tags).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prisma.unmappedXbrlTag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { occurrenceCount: 'desc' },
        }),
      );
    });

    it('should filter by statement type', async () => {
      prisma.unmappedXbrlTag.findMany.mockResolvedValue([]);
      prisma.unmappedXbrlTag.count.mockResolvedValue(0);

      await service.listUnmappedTags({ statementType: 'balance_sheet' });

      expect(prisma.unmappedXbrlTag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            statementType: 'balance_sheet',
          }),
        }),
      );
    });

    it('should filter by minimum occurrences', async () => {
      prisma.unmappedXbrlTag.findMany.mockResolvedValue([]);
      prisma.unmappedXbrlTag.count.mockResolvedValue(0);

      await service.listUnmappedTags({ minOccurrences: 5 });

      expect(prisma.unmappedXbrlTag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            occurrenceCount: { gte: 5 },
          }),
        }),
      );
    });
  });

  describe('addMapping', () => {
    it('should add mapping and queue re-processing', async () => {
      prisma.unmappedXbrlTag.findUnique.mockResolvedValue(mockUnmappedTag);
      prisma.xbrlTagMapping.findFirst.mockResolvedValue(null);
      prisma.xbrlTagMapping.create.mockResolvedValue({
        id: 'mapping-1',
        xbrlTag: 'cmcsa:ProgrammingAndProduction',
        normalizedMetric: 'programming_and_production',
        displayName: 'Programming and Production',
        statementType: 'income_statement',
        source: 'manual',
        createdBy: 'admin@test.com',
        version: '1.0.0',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.unmappedXbrlTag.update.mockResolvedValue({
        ...mockUnmappedTag,
        status: 'mapped',
      });
      prisma.reprocessingQueue.createMany.mockResolvedValue({ count: 1 });

      const result = await service.addMapping(
        'tag-1',
        {
          xbrlTag: 'cmcsa:ProgrammingAndProduction',
          normalizedMetric: 'programming_and_production',
          displayName: 'Programming and Production',
          statementType: 'income_statement',
        },
        'admin@test.com',
      );

      expect(result.success).toBe(true);
      expect(result.affectedFilings).toContain('CMCSA:10-K');
      expect(prisma.xbrlTagMapping.create).toHaveBeenCalled();
      expect(prisma.unmappedXbrlTag.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'mapped',
            mappedBy: 'admin@test.com',
          }),
        }),
      );
    });

    it('should throw NotFoundException for non-existent tag', async () => {
      prisma.unmappedXbrlTag.findUnique.mockResolvedValue(null);

      await expect(
        service.addMapping(
          'non-existent',
          {
            xbrlTag: 'test:Tag',
            normalizedMetric: 'test_metric',
            displayName: 'Test Metric',
            statementType: 'income_statement',
          },
          'admin@test.com',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('ignoreTag', () => {
    it('should mark tag as ignored', async () => {
      prisma.unmappedXbrlTag.update.mockResolvedValue({
        ...mockUnmappedTag,
        status: 'ignored',
      });

      await service.ignoreTag('tag-1', 'admin@test.com', 'Not needed');

      expect(prisma.unmappedXbrlTag.update).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
        data: expect.objectContaining({
          status: 'ignored',
          mappedBy: 'admin@test.com',
          notes: 'Not needed',
        }),
      });
    });
  });

  describe('recordValidationFailure', () => {
    it('should create new validation failure record', async () => {
      prisma.validationFailure.findFirst.mockResolvedValue(null);
      prisma.validationFailure.create.mockResolvedValue(mockValidationFailure);

      await service.recordValidationFailure(
        'AAPL',
        '10-K',
        'FY2024',
        'Total Assets = Current + Non-Current Assets',
        'mathematical',
        1000000,
        950000,
        5.0,
      );

      expect(prisma.validationFailure.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          ticker: 'AAPL',
          checkName: 'Total Assets = Current + Non-Current Assets',
          status: 'pending',
        }),
      });
    });

    it('should not create duplicate failure', async () => {
      prisma.validationFailure.findFirst.mockResolvedValue(mockValidationFailure);

      await service.recordValidationFailure(
        'AAPL',
        '10-K',
        'FY2024',
        'Total Assets = Current + Non-Current Assets',
        'mathematical',
        1000000,
        950000,
        5.0,
      );

      expect(prisma.validationFailure.create).not.toHaveBeenCalled();
    });
  });

  describe('listValidationFailures', () => {
    it('should list validation failures sorted by difference', async () => {
      prisma.validationFailure.findMany.mockResolvedValue([mockValidationFailure]);
      prisma.validationFailure.count.mockResolvedValue(1);

      const result = await service.listValidationFailures({ status: 'pending' });

      expect(result.failures).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prisma.validationFailure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ differencePct: 'desc' }, { createdAt: 'desc' }],
        }),
      );
    });

    it('should filter by ticker', async () => {
      prisma.validationFailure.findMany.mockResolvedValue([]);
      prisma.validationFailure.count.mockResolvedValue(0);

      await service.listValidationFailures({ ticker: 'AAPL' });

      expect(prisma.validationFailure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ticker: 'AAPL',
          }),
        }),
      );
    });
  });

  describe('resolveValidationFailure', () => {
    it('should resolve validation failure with audit trail', async () => {
      prisma.validationFailure.findUnique.mockResolvedValue(mockValidationFailure);
      prisma.validationFailure.update.mockResolvedValue({
        ...mockValidationFailure,
        status: 'resolved',
      });
      prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      await service.resolveValidationFailure(
        'failure-1',
        { resolution: 'data_corrected', notes: 'Fixed calculation' },
        'admin@test.com',
      );

      expect(prisma.validationFailure.update).toHaveBeenCalledWith({
        where: { id: 'failure-1' },
        data: expect.objectContaining({
          status: 'resolved',
          resolvedBy: 'admin@test.com',
        }),
      });
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('should throw NotFoundException for non-existent failure', async () => {
      prisma.validationFailure.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveValidationFailure(
          'non-existent',
          { resolution: 'data_corrected' },
          'admin@test.com',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should set status to overridden for override_accepted resolution', async () => {
      prisma.validationFailure.findUnique.mockResolvedValue(mockValidationFailure);
      prisma.validationFailure.update.mockResolvedValue({
        ...mockValidationFailure,
        status: 'overridden',
      });
      prisma.auditLog.create.mockResolvedValue({ id: 'audit-1' });

      await service.resolveValidationFailure(
        'failure-1',
        { resolution: 'override_accepted' },
        'admin@test.com',
      );

      expect(prisma.validationFailure.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'overridden',
          }),
        }),
      );
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      prisma.unmappedXbrlTag.count
        .mockResolvedValueOnce(10) // pending
        .mockResolvedValueOnce(5)  // mapped
        .mockResolvedValueOnce(2); // ignored
      prisma.validationFailure.count
        .mockResolvedValueOnce(8)  // pending
        .mockResolvedValueOnce(3)  // resolved
        .mockResolvedValueOnce(1); // overridden
      prisma.reprocessingQueue.count
        .mockResolvedValueOnce(4)  // pending
        .mockResolvedValueOnce(20) // completed
        .mockResolvedValueOnce(2); // failed

      const stats = await service.getQueueStats();

      expect(stats.unmappedTags.pending).toBe(10);
      expect(stats.unmappedTags.mapped).toBe(5);
      expect(stats.unmappedTags.ignored).toBe(2);
      expect(stats.unmappedTags.total).toBe(17);
      expect(stats.validationFailures.pending).toBe(8);
      expect(stats.validationFailures.resolved).toBe(3);
      expect(stats.reprocessingQueue.pending).toBe(4);
    });
  });
});
