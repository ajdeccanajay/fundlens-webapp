import { Test, TestingModule } from '@nestjs/testing';
import { MetricCorrectionService } from '../../src/rag/metric-resolution/metric-correction.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('MetricCorrectionService', () => {
  let service: MetricCorrectionService;
  let prisma: {
    metricResolutionLog: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      metricResolutionLog: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricCorrectionService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MetricCorrectionService>(MetricCorrectionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordCorrection', () => {
    it('should update the most recent log entry with userChoice', async () => {
      const mockLog = {
        id: 'log-uuid-123',
        tenantId: 'tenant-1',
        rawQuery: 'lev ratio',
        confidence: 'unresolved',
        resolvedTo: null,
        suggestions: ['net_debt_to_ebitda', 'debt_to_equity'],
        userChoice: null,
        timestamp: new Date(),
      };

      prisma.metricResolutionLog.findFirst.mockResolvedValue(mockLog);
      prisma.metricResolutionLog.update.mockResolvedValue({
        ...mockLog,
        userChoice: 'net_debt_to_ebitda',
      });

      const result = await service.recordCorrection({
        rawQuery: 'lev ratio',
        selectedMetricId: 'net_debt_to_ebitda',
        tenantId: 'tenant-1',
      });

      expect(result.success).toBe(true);
      expect(result.logId).toBe('log-uuid-123');
      expect(prisma.metricResolutionLog.findFirst).toHaveBeenCalledWith({
        where: { rawQuery: 'lev ratio', tenantId: 'tenant-1' },
        orderBy: { timestamp: 'desc' },
      });
      expect(prisma.metricResolutionLog.update).toHaveBeenCalledWith({
        where: { id: 'log-uuid-123' },
        data: { userChoice: 'net_debt_to_ebitda' },
      });
    });

    it('should return failure when no log entry is found', async () => {
      prisma.metricResolutionLog.findFirst.mockResolvedValue(null);

      const result = await service.recordCorrection({
        rawQuery: 'nonexistent query',
        selectedMetricId: 'some_metric',
        tenantId: 'tenant-1',
      });

      expect(result.success).toBe(false);
      expect(result.logId).toBeNull();
      expect(result.message).toContain('No resolution log found');
      expect(prisma.metricResolutionLog.update).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      prisma.metricResolutionLog.findFirst.mockRejectedValue(
        new Error('Connection refused'),
      );

      const result = await service.recordCorrection({
        rawQuery: 'revenue',
        selectedMetricId: 'total_revenue',
        tenantId: 'tenant-1',
      });

      expect(result.success).toBe(false);
      expect(result.logId).toBeNull();
      expect(result.message).toContain('Failed to record correction');
    });

    it('should find the most recent log entry by ordering desc', async () => {
      const mockLog = {
        id: 'latest-log',
        tenantId: 'tenant-2',
        rawQuery: 'cash',
        confidence: 'unresolved',
        resolvedTo: null,
        suggestions: ['cash_and_cash_equivalents'],
        userChoice: null,
        timestamp: new Date(),
      };

      prisma.metricResolutionLog.findFirst.mockResolvedValue(mockLog);
      prisma.metricResolutionLog.update.mockResolvedValue({
        ...mockLog,
        userChoice: 'cash_and_cash_equivalents',
      });

      const result = await service.recordCorrection({
        rawQuery: 'cash',
        selectedMetricId: 'cash_and_cash_equivalents',
        tenantId: 'tenant-2',
      });

      expect(result.success).toBe(true);
      expect(result.logId).toBe('latest-log');
    });
  });
});
