import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FormulaManagementService,
  CreateFormulaDto,
} from '../../src/admin/formula-management.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FinancialCalculatorService } from '../../src/deals/financial-calculator.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';

describe('FormulaManagementService', () => {
  let service: FormulaManagementService;
  let prisma: jest.Mocked<PrismaService>;
  let calculator: jest.Mocked<FinancialCalculatorService>;
  let registry: jest.Mocked<MetricRegistryService>;

  const mockFormula = {
    id: 'uuid-1',
    canonicalId: 'custom_ratio',
    displayName: 'Custom Ratio',
    formula: 'revenue / total_assets',
    dependencies: ['revenue', 'total_assets'],
    outputFormat: 'ratio',
    category: 'efficiency',
    industry: 'all',
    assetClass: ['public_equity'],
    interpretation: null,
    synonyms: null,
    calculationNotes: null,
    submittedBy: 'admin@test.com',
    reviewedBy: null,
    status: 'pending_review',
    rejectionReason: null,
    submittedAt: new Date('2026-01-01'),
    reviewedAt: null,
  };

  beforeEach(async () => {
    const mockPrisma = {
      pendingFormula: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockCalculator = {
      evaluateFormula: jest.fn(),
    };

    const mockRegistry = {
      rebuildIndex: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormulaManagementService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FinancialCalculatorService, useValue: mockCalculator },
        { provide: MetricRegistryService, useValue: mockRegistry },
      ],
    }).compile();

    service = module.get(FormulaManagementService);
    prisma = module.get(PrismaService);
    calculator = module.get(FinancialCalculatorService);
    registry = module.get(MetricRegistryService);
  });

  describe('createFormula', () => {
    const dto: CreateFormulaDto = {
      canonicalId: 'custom_ratio',
      displayName: 'Custom Ratio',
      dependencies: ['revenue', 'total_assets'],
      formula: 'revenue / total_assets',
      outputFormat: 'ratio',
      category: 'efficiency',
      submittedBy: 'admin@test.com',
    };

    it('should validate formula via Python and save on success', async () => {
      (calculator.evaluateFormula as jest.Mock).mockResolvedValue({
        result: 0.5,
        audit_trail: { formula: dto.formula },
      });
      (prisma.pendingFormula.create as jest.Mock).mockResolvedValue(mockFormula);

      const result = await service.createFormula(dto);

      expect(calculator.evaluateFormula).toHaveBeenCalledWith(
        dto.formula,
        { revenue: 1000000, total_assets: 1000000 },
        dto.outputFormat,
      );
      expect(prisma.pendingFormula.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          canonicalId: dto.canonicalId,
          displayName: dto.displayName,
          formula: dto.formula,
          submittedBy: dto.submittedBy,
        }),
      });
      expect(result).toEqual(mockFormula);
    });

    it('should throw BadRequestException when Python validation fails', async () => {
      (calculator.evaluateFormula as jest.Mock).mockResolvedValue({
        result: null,
        error: "Missing variable 'total_assets' in inputs",
      });

      await expect(service.createFormula(dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createFormula(dto)).rejects.toThrow(
        "Formula validation failed: Missing variable 'total_assets' in inputs",
      );
      expect(prisma.pendingFormula.create).not.toHaveBeenCalled();
    });
  });

  describe('listPending', () => {
    it('should return only pending_review formulas ordered by submittedAt desc', async () => {
      const pending = [mockFormula];
      (prisma.pendingFormula.findMany as jest.Mock).mockResolvedValue(pending);

      const result = await service.listPending();

      expect(prisma.pendingFormula.findMany).toHaveBeenCalledWith({
        where: { status: 'pending_review' },
        orderBy: { submittedAt: 'desc' },
      });
      expect(result).toEqual(pending);
    });
  });

  describe('getById', () => {
    it('should return formula when found', async () => {
      (prisma.pendingFormula.findUnique as jest.Mock).mockResolvedValue(
        mockFormula,
      );

      const result = await service.getById('uuid-1');

      expect(prisma.pendingFormula.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
      expect(result).toEqual(mockFormula);
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.pendingFormula.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('approve', () => {
    it('should update status to approved and trigger rebuildIndex', async () => {
      const approved = {
        ...mockFormula,
        status: 'approved',
        reviewedBy: 'reviewer@test.com',
        reviewedAt: new Date(),
      };
      (prisma.pendingFormula.findUnique as jest.Mock).mockResolvedValue(
        mockFormula,
      );
      (prisma.pendingFormula.update as jest.Mock).mockResolvedValue(approved);
      (registry.rebuildIndex as jest.Mock).mockResolvedValue({
        metricsLoaded: 252,
        synonymsIndexed: 1209,
        collisions: 0,
        loadTimeMs: 100,
      });

      const result = await service.approve('uuid-1', 'reviewer@test.com');

      expect(prisma.pendingFormula.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          status: 'approved',
          reviewedBy: 'reviewer@test.com',
          reviewedAt: expect.any(Date),
        },
      });
      expect(registry.rebuildIndex).toHaveBeenCalled();
      expect(result).toEqual(approved);
    });

    it('should throw NotFoundException when formula not found', async () => {
      (prisma.pendingFormula.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.approve('nonexistent', 'reviewer@test.com'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reject', () => {
    it('should update status to rejected with reason', async () => {
      const rejected = {
        ...mockFormula,
        status: 'rejected',
        rejectionReason: 'Formula is incorrect',
        reviewedBy: 'reviewer@test.com',
        reviewedAt: new Date(),
      };
      (prisma.pendingFormula.findUnique as jest.Mock).mockResolvedValue(
        mockFormula,
      );
      (prisma.pendingFormula.update as jest.Mock).mockResolvedValue(rejected);

      const result = await service.reject(
        'uuid-1',
        'Formula is incorrect',
        'reviewer@test.com',
      );

      expect(prisma.pendingFormula.update).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        data: {
          status: 'rejected',
          rejectionReason: 'Formula is incorrect',
          reviewedBy: 'reviewer@test.com',
          reviewedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(rejected);
    });

    it('should throw NotFoundException when formula not found', async () => {
      (prisma.pendingFormula.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.reject('nonexistent', 'reason', 'reviewer@test.com'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
