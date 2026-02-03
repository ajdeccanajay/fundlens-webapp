import { XLSXGenerator } from '../../src/deals/xlsx-generator';
import { StatementType, MetricRow, StatementData, FilingType } from '../../src/deals/export.types';
import * as ExcelJS from 'exceljs';

describe('XLSXGenerator', () => {
  let generator: XLSXGenerator;

  beforeEach(() => {
    generator = new XLSXGenerator();
  });

  describe('generateWorkbook', () => {
    it('should generate a workbook with correct structure', async () => {
      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024', '2023'],
          metrics: [
            {
              displayName: 'REVENUE',
              normalizedMetric: 'revenue_header',
              values: new Map(),
              reportingUnits: new Map(),
              isHeader: true,
            },
            {
              displayName: 'Total Revenue',
              normalizedMetric: 'revenue',
              values: new Map([['2024', 383285000000], ['2023', 365817000000]]),
              reportingUnits: new Map([['2024', 'millions'], ['2023', 'millions']]),
              format: 'currency',
            },
          ],
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Parse the workbook to verify structure
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);

      expect(workbook.worksheets.length).toBe(1);
      expect(workbook.worksheets[0].name).toBe('Income Statement');
    });

    it('should include reporting units in metric rows', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000000]]),
          reportingUnits: new Map([['2024', 'millions']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      // Find the revenue row (should be after headers)
      // Row 1: Company name, Row 2: Ticker, Row 3: Units, Row 4: Empty, Row 5: Title, Row 6: Column headers, Row 7: Data
      const revenueRow = worksheet.getRow(7);
      const valueCell = revenueRow.getCell(2);

      // Value should be stored as number
      expect(typeof valueCell.value).toBe('number');
      expect(valueCell.value).toBe(383285000000);
    });
  });

  describe('reporting unit formatting', () => {
    it('should format values in millions when reportingUnit is millions', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000000]]),
          reportingUnits: new Map([['2024', 'millions']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const revenueRow = worksheet.getRow(7);
      const valueCell = revenueRow.getCell(2);

      // Check that the number format includes "M" for millions
      expect(valueCell.numFmt).toContain('M');
    });

    it('should format values in billions when reportingUnit is billions', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000000]]),
          reportingUnits: new Map([['2024', 'billions']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const revenueRow = worksheet.getRow(7);
      const valueCell = revenueRow.getCell(2);

      // Check that the number format includes "B" for billions
      expect(valueCell.numFmt).toContain('B');
    });

    it('should format values in thousands when reportingUnit is thousands', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000]]),
          reportingUnits: new Map([['2024', 'thousands']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const revenueRow = worksheet.getRow(7);
      const valueCell = revenueRow.getCell(2);

      // Check that the number format includes "K" for thousands
      expect(valueCell.numFmt).toContain('K');
    });

    it('should fallback to magnitude-based formatting when reportingUnit is units', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000000]]),
          reportingUnits: new Map([['2024', 'units']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const revenueRow = worksheet.getRow(7);
      const valueCell = revenueRow.getCell(2);

      // For large values with 'units', should fallback to billions
      expect(valueCell.numFmt).toContain('B');
    });

    it('should handle EPS format correctly (always in actual units)', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Basic EPS',
          normalizedMetric: 'eps_basic',
          values: new Map([['2024', 6.13]]),
          reportingUnits: new Map([['2024', 'units']]),
          format: 'eps',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const epsRow = worksheet.getRow(7);
      const valueCell = epsRow.getCell(2);

      // EPS should be formatted as currency with 2 decimal places
      expect(valueCell.numFmt).toBe('$#,##0.00');
      expect(valueCell.value).toBe(6.13);
    });

    it('should handle percentage format correctly', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Gross Margin %',
          normalizedMetric: 'gross_margin',
          values: new Map([['2024', 0.4523]]),
          reportingUnits: new Map([['2024', 'units']]),
          format: 'percentage',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const marginRow = worksheet.getRow(7);
      const valueCell = marginRow.getCell(2);

      // Percentage should be formatted with % symbol
      expect(valueCell.numFmt).toContain('%');
    });

    it('should handle N/A values correctly', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', null]]),
          reportingUnits: new Map([['2024', 'millions']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const revenueRow = worksheet.getRow(7);
      const valueCell = revenueRow.getCell(2);

      // Null values should display as 'N/A'
      expect(valueCell.value).toBe('N/A');
    });
  });

  describe('header rows', () => {
    it('should style header rows correctly', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'REVENUE',
          normalizedMetric: 'revenue_header',
          values: new Map(),
          reportingUnits: new Map(),
          isHeader: true,
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const headerRow = worksheet.getRow(7);
      const nameCell = headerRow.getCell(1);

      // Header should have bold font
      expect(nameCell.font?.bold).toBe(true);
    });
  });

  describe('SEC-style reporting unit header', () => {
    it('should display SEC-style header when reportingUnitInfo is provided', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000000]]),
          reportingUnits: new Map([['2024', 'millions']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
        reportingUnitInfo: {
          defaultUnit: 'millions',
          shareUnit: 'thousands',
          perShareUnit: 'units',
        },
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      // Row 3 should contain the units header
      const unitsRow = worksheet.getRow(3);
      const unitsCell = unitsRow.getCell(1);
      const unitsText = String(unitsCell.value);

      // Should contain SEC-style formatting
      expect(unitsText).toContain('In millions');
      expect(unitsText).toContain('shares');
      expect(unitsText).toContain('thousands');
    });

    it('should display simple header when share unit matches default', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000000]]),
          reportingUnits: new Map([['2024', 'millions']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
        reportingUnitInfo: {
          defaultUnit: 'millions',
          shareUnit: 'millions',
          perShareUnit: 'units',
        },
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const unitsRow = worksheet.getRow(3);
      const unitsCell = unitsRow.getCell(1);
      const unitsText = String(unitsCell.value);

      // Should contain simple format with per-share exception
      expect(unitsText).toContain('In millions');
      expect(unitsText).toContain('per-share');
    });

    it('should display fallback header when no reportingUnitInfo provided', async () => {
      const metrics: MetricRow[] = [
        {
          displayName: 'Total Revenue',
          normalizedMetric: 'revenue',
          values: new Map([['2024', 383285000000]]),
          reportingUnits: new Map([['2024', 'millions']]),
          format: 'currency',
        },
      ];

      const statementData: StatementData[] = [
        {
          statementType: StatementType.INCOME_STATEMENT,
          filingType: FilingType.TEN_K,
          periods: ['2024'],
          metrics,
        },
      ];

      const buffer = await generator.generateWorkbook(statementData, {
        companyName: 'Apple Inc.',
        ticker: 'AAPL',
        filingType: '10-K Annual',
        // No reportingUnitInfo
      });

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const worksheet = workbook.worksheets[0];

      const unitsRow = worksheet.getRow(3);
      const unitsCell = unitsRow.getCell(1);
      const unitsText = String(unitsCell.value);

      // Should contain fallback format
      expect(unitsText).toContain('Values in USD');
      expect(unitsText).toContain('B=Billions');
      expect(unitsText).toContain('M=Millions');
    });
  });
});
