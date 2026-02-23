/**
 * Fiscal Period Sort Key Unit Tests
 * Tests that parseFiscalPeriodSortKey() correctly sorts fiscal periods.
 * 
 * The bug: the annual regex /FY(\d{4})/ matched inside "Q3FY2024" before
 * the quarterly regex got a chance, producing 20240000 instead of 20240300.
 * Fix: check quarterly pattern first since it's more specific.
 * 
 * Validates: Requirements 4.1, 4.2, 4.3, 4.4
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricRegistryService } from '../../src/rag/metric-resolution/metric-registry.service';
import { FormulaResolutionService } from '../../src/rag/metric-resolution/formula-resolution.service';

describe('Fiscal Period Sort Key', () => {
  let service: StructuredRetrieverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        {
          provide: PrismaService,
          useValue: {
            financialMetric: { findMany: jest.fn().mockResolvedValue([]) },
            calculatedMetric: { findMany: jest.fn().mockResolvedValue([]) },
            $queryRaw: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: MetricRegistryService,
          useValue: {
            getSynonymsForDbColumn: jest.fn().mockReturnValue([]),
          },
        },
        {
          provide: FormulaResolutionService,
          useValue: {
            resolveComputed: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<StructuredRetrieverService>(StructuredRetrieverService);
  });

  // Access the private method for direct testing
  const getSortKey = (svc: any, period: string): number => {
    return svc.parseFiscalPeriodSortKey(period);
  };

  describe('Annual periods (Requirement 4.1)', () => {
    it('FY2024 → 20240000', () => {
      expect(getSortKey(service, 'FY2024')).toBe(20240000);
    });

    it('FY2023 → 20230000', () => {
      expect(getSortKey(service, 'FY2023')).toBe(20230000);
    });

    it('FY2025 → 20250000', () => {
      expect(getSortKey(service, 'FY2025')).toBe(20250000);
    });
  });

  describe('Quarterly periods (Requirement 4.2)', () => {
    it('Q3FY2024 → 20240300', () => {
      expect(getSortKey(service, 'Q3FY2024')).toBe(20240300);
    });

    it('Q1FY2025 → 20250100', () => {
      expect(getSortKey(service, 'Q1FY2025')).toBe(20250100);
    });

    it('Q2FY2025 → 20250200', () => {
      expect(getSortKey(service, 'Q2FY2025')).toBe(20250200);
    });

    it('Q4FY2024 → 20240400', () => {
      expect(getSortKey(service, 'Q4FY2024')).toBe(20240400);
    });
  });

  describe('TTM (Requirement 4.3)', () => {
    it('TTM → 99990000', () => {
      expect(getSortKey(service, 'TTM')).toBe(99990000);
    });

    it('ttm (lowercase) → 99990000', () => {
      expect(getSortKey(service, 'ttm')).toBe(99990000);
    });
  });

  describe('Sort ordering (Requirement 4.4)', () => {
    it('Q3FY2025 > Q2FY2025 > Q1FY2025 > FY2024', () => {
      const periods = ['FY2024', 'Q1FY2025', 'Q3FY2025', 'Q2FY2025'];
      const sorted = periods.sort(
        (a, b) => getSortKey(service, b) - getSortKey(service, a),
      );
      expect(sorted).toEqual(['Q3FY2025', 'Q2FY2025', 'Q1FY2025', 'FY2024']);
    });

    it('TTM ranks above all fiscal periods', () => {
      const periods = ['FY2024', 'Q3FY2025', 'TTM'];
      const sorted = periods.sort(
        (a, b) => getSortKey(service, b) - getSortKey(service, a),
      );
      expect(sorted[0]).toBe('TTM');
    });

    it('latest quarterly returns Q3FY2025 when FY2024 and Q1-Q3FY2025 exist', () => {
      const periods = ['FY2024', 'Q1FY2025', 'Q2FY2025', 'Q3FY2025'];
      const sorted = periods.sort(
        (a, b) => getSortKey(service, b) - getSortKey(service, a),
      );
      expect(sorted[0]).toBe('Q3FY2025');
    });
  });

  describe('Edge cases', () => {
    it('bare year 2024 → 20240000', () => {
      expect(getSortKey(service, '2024')).toBe(20240000);
    });

    it('unrecognized string → 0', () => {
      expect(getSortKey(service, 'unknown')).toBe(0);
    });

    it('Q3 FY2024 with space → 20240300', () => {
      expect(getSortKey(service, 'Q3 FY2024')).toBe(20240300);
    });

    it('Q3-FY2024 with hyphen → 20240300', () => {
      expect(getSortKey(service, 'Q3-FY2024')).toBe(20240300);
    });

    it('Q32024 without FY → 20240300', () => {
      expect(getSortKey(service, 'Q32024')).toBe(20240300);
    });
  });
});
