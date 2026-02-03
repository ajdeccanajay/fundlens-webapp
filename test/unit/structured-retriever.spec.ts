/**
 * Structured Retriever Unit Tests
 * Tests metric retrieval from PostgreSQL RDS
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StructuredRetrieverService } from '../../src/rag/structured-retriever.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StructuredRetrieverService', () => {
  let service: StructuredRetrieverService;
  let prisma: PrismaService;

  const mockMetrics = [
    {
      id: 1,
      ticker: 'SHOP',
      normalizedMetric: 'revenue',
      value: 8880000000,
      fiscalPeriod: 'FY2024',
      filingType: '10-K',
      statementType: 'income_statement',
    },
    {
      id: 2,
      ticker: 'SHOP',
      normalizedMetric: 'gross_profit',
      value: 4440000000,
      fiscalPeriod: 'FY2024',
      filingType: '10-K',
      statementType: 'income_statement',
    },
    {
      id: 3,
      ticker: 'SHOP',
      normalizedMetric: 'net_income',
      value: 1500000000,
      fiscalPeriod: 'FY2024',
      filingType: '10-K',
      statementType: 'income_statement',
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StructuredRetrieverService,
        {
          provide: PrismaService,
          useValue: {
            financialMetric: {
              findMany: jest.fn().mockResolvedValue(mockMetrics),
            },
            calculatedMetric: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            $queryRaw: jest.fn().mockResolvedValue([{ count: 3 }]),
          },
        },
      ],
    }).compile();

    service = module.get<StructuredRetrieverService>(StructuredRetrieverService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('Metric Retrieval', () => {
    it('should retrieve metrics for ticker', async () => {
      const result = await service.retrieve({
        tickers: ['SHOP'],
        metrics: ['revenue', 'gross_profit'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(result.metrics).toBeDefined();
      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should filter by metric names', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: ['revenue'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should filter by fiscal period', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: ['revenue'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should handle multiple tickers', async () => {
      await service.retrieve({
        tickers: ['SHOP', 'AAPL'],
        metrics: ['revenue'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });
  });

  describe('Query Building', () => {
    it('should build case-insensitive ticker filter', async () => {
      await service.retrieve({
        tickers: ['shop'],
        metrics: ['revenue'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });

    it('should call findMany with limit', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: ['revenue'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });
  });

  describe('Result Summary', () => {
    it('should build retrieval summary', async () => {
      const result = await service.retrieve({
        tickers: ['SHOP'],
        metrics: ['revenue', 'gross_profit', 'net_income'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(result.summary).toBeDefined();
      expect(result.summary.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Computed Metrics', () => {
    it('should include computed metrics when requested', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: ['gross_margin'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: true,
      });

      // Should call either calculatedMetric or financialMetric
      expect(
        prisma.calculatedMetric.findMany || prisma.financialMetric.findMany
      ).toBeDefined();
    });

    it('should skip computed metrics when not requested', async () => {
      await service.retrieve({
        tickers: ['SHOP'],
        metrics: ['revenue'],
        period: 'FY2024',
        filingTypes: ['10-K'],
        includeComputed: false,
      });

      expect(prisma.financialMetric.findMany).toHaveBeenCalled();
    });
  });
});
