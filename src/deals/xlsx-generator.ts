import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { StatementData, MetricRow, StatementType } from './export.types';

interface WorkbookOptions {
  companyName: string;
  ticker: string;
  filingType: string;
  reportingUnitInfo?: ReportingUnitInfo;
}

interface ReportingUnitInfo {
  defaultUnit: string;  // 'units', 'thousands', 'millions', 'billions'
  shareUnit?: string;   // Unit for share counts (may differ from default)
  perShareUnit?: string; // Unit for per-share amounts (usually 'units')
  source?: string;      // Where the unit was extracted from
}

interface Filing8K {
  filing_date: Date;
  fiscal_period: string;
}

interface Options8K {
  companyName: string;
  ticker: string;
  dateRange: { start: string; end: string };
}

@Injectable()
export class XLSXGenerator {
  private readonly logger = new Logger(XLSXGenerator.name);

  // Style constants
  private readonly HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F4E79' }, // Dark blue
  };

  private readonly SECTION_HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9E2F3' }, // Light blue
  };

  private readonly HEADER_FONT: Partial<ExcelJS.Font> = {
    bold: true,
    color: { argb: 'FFFFFFFF' },
    size: 11,
  };

  private readonly SECTION_HEADER_FONT: Partial<ExcelJS.Font> = {
    bold: true,
    color: { argb: 'FF1F4E79' },
    size: 10,
  };

  private readonly DATA_FONT: Partial<ExcelJS.Font> = {
    size: 10,
  };

  /**
   * Generate Excel workbook from statement data
   */
  async generateWorkbook(
    statementDataList: StatementData[],
    options: WorkbookOptions,
  ): Promise<Buffer> {
    this.logger.log(`Generating workbook for ${options.ticker} with ${statementDataList.length} statements`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FundLens';
    workbook.created = new Date();

    for (const statementData of statementDataList) {
      this.addStatementWorksheet(workbook, statementData, options);
    }

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Add a worksheet for a financial statement
   */
  private addStatementWorksheet(
    workbook: ExcelJS.Workbook,
    statementData: StatementData,
    options: WorkbookOptions,
  ): void {
    const worksheetName = this.getWorksheetName(statementData.statementType);
    const worksheet = workbook.addWorksheet(worksheetName);

    // Set column widths
    const columns: Partial<ExcelJS.Column>[] = [
      { width: 45 }, // Metric name column
    ];
    for (let i = 0; i < statementData.periods.length; i++) {
      columns.push({ width: 18 }); // Period columns
    }
    worksheet.columns = columns;

    let rowNum = 1;

    // Add company header
    rowNum = this.addCompanyHeader(worksheet, rowNum, options, statementData.periods.length);

    // Add statement title
    rowNum = this.addStatementTitle(worksheet, rowNum, statementData.statementType, options.filingType);

    // Add column headers (periods)
    rowNum = this.addColumnHeaders(worksheet, rowNum, statementData.periods);

    // Add data rows
    rowNum = this.addDataRows(worksheet, rowNum, statementData.metrics, statementData.periods);

    // Freeze panes (freeze first column and header rows)
    worksheet.views = [
      { state: 'frozen', xSplit: 1, ySplit: 5 },
    ];
  }

  /**
   * Add company header section with SEC-style reporting unit display
   */
  private addCompanyHeader(
    worksheet: ExcelJS.Worksheet,
    startRow: number,
    options: WorkbookOptions,
    periodCount: number,
  ): number {
    // Company name row
    const companyRow = worksheet.getRow(startRow);
    companyRow.getCell(1).value = options.companyName;
    companyRow.getCell(1).font = { bold: true, size: 14 };
    worksheet.mergeCells(startRow, 1, startRow, periodCount + 1);

    // Ticker row
    const tickerRow = worksheet.getRow(startRow + 1);
    tickerRow.getCell(1).value = `Ticker: ${options.ticker} | ${options.filingType}`;
    tickerRow.getCell(1).font = { size: 11, color: { argb: 'FF666666' } };
    worksheet.mergeCells(startRow + 1, 1, startRow + 1, periodCount + 1);

    // Units row - Format in SEC filing style
    const unitsRow = worksheet.getRow(startRow + 2);
    const unitsText = this.formatReportingUnitHeader(options.reportingUnitInfo);
    unitsRow.getCell(1).value = unitsText;
    unitsRow.getCell(1).font = { size: 10, italic: true, color: { argb: 'FF666666' } };
    worksheet.mergeCells(startRow + 2, 1, startRow + 2, periodCount + 1);

    // Empty row for spacing
    return startRow + 4;
  }

  /**
   * Format reporting unit header in SEC filing style
   * Examples:
   * - "(In millions, except number of shares, which are reflected in thousands, and per-share amounts)"
   * - "(In millions)"
   * - "(Dollars in thousands)"
   */
  private formatReportingUnitHeader(reportingUnitInfo?: ReportingUnitInfo): string {
    if (!reportingUnitInfo || reportingUnitInfo.defaultUnit === 'units') {
      // Default fallback message
      return '(Values in USD | Displayed as: B=Billions, M=Millions, K=Thousands | EPS & ratios in actual units)';
    }

    const defaultUnit = reportingUnitInfo.defaultUnit;
    const shareUnit = reportingUnitInfo.shareUnit || defaultUnit;
    const perShareUnit = reportingUnitInfo.perShareUnit || 'units';

    // Build SEC-style header
    let header = `(In ${defaultUnit}`;

    // Add share exception if different from default
    if (shareUnit !== defaultUnit) {
      header += `, except number of shares, which are reflected in ${shareUnit}`;
    }

    // Add per-share exception (always in actual units)
    if (perShareUnit === 'units') {
      if (shareUnit !== defaultUnit) {
        header += ', and per-share amounts';
      } else {
        header += ', except per-share amounts';
      }
    }

    header += ')';

    return header;
  }

  /**
   * Add statement title row
   */
  private addStatementTitle(
    worksheet: ExcelJS.Worksheet,
    startRow: number,
    statementType: StatementType,
    filingType: string,
  ): number {
    const titleRow = worksheet.getRow(startRow);
    const title = this.getStatementTitle(statementType);
    titleRow.getCell(1).value = title;
    titleRow.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF1F4E79' } };

    return startRow + 1;
  }

  /**
   * Add column headers (fiscal periods)
   */
  private addColumnHeaders(
    worksheet: ExcelJS.Worksheet,
    startRow: number,
    periods: string[],
  ): number {
    const headerRow = worksheet.getRow(startRow);

    // First column header
    headerRow.getCell(1).value = 'Line Item';
    headerRow.getCell(1).fill = this.HEADER_FILL;
    headerRow.getCell(1).font = this.HEADER_FONT;
    headerRow.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };

    // Period column headers
    for (let i = 0; i < periods.length; i++) {
      const cell = headerRow.getCell(i + 2);
      cell.value = this.formatPeriodHeader(periods[i]);
      cell.fill = this.HEADER_FILL;
      cell.font = this.HEADER_FONT;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }

    headerRow.height = 22;

    return startRow + 1;
  }

  /**
   * Add data rows for metrics
   */
  private addDataRows(
    worksheet: ExcelJS.Worksheet,
    startRow: number,
    metrics: MetricRow[],
    periods: string[],
  ): number {
    let currentRow = startRow;

    for (const metric of metrics) {
      const row = worksheet.getRow(currentRow);

      // Metric name cell
      const nameCell = row.getCell(1);
      nameCell.value = metric.displayName;
      
      if (metric.isHeader) {
        // Section header styling
        nameCell.fill = this.SECTION_HEADER_FILL;
        nameCell.font = this.SECTION_HEADER_FONT;
        
        // Fill remaining cells with section header background
        for (let i = 0; i < periods.length; i++) {
          const cell = row.getCell(i + 2);
          cell.fill = this.SECTION_HEADER_FILL;
        }
      } else {
        // Data row styling
        nameCell.font = this.DATA_FONT;
        nameCell.alignment = { horizontal: 'left', vertical: 'middle' };

        // Add indentation
        if (metric.indent && metric.indent > 0) {
          nameCell.alignment = { 
            horizontal: 'left', 
            vertical: 'middle',
            indent: metric.indent * 2,
          };
        }

        // Value cells
        for (let i = 0; i < periods.length; i++) {
          const cell = row.getCell(i + 2);
          const value = metric.values.get(periods[i]);
          // Get the actual reporting unit from SEC filing (units, thousands, millions, billions)
          const reportingUnit = metric.reportingUnits?.get(periods[i]) || 'units';

          if (value !== null && value !== undefined) {
            cell.value = value;
            this.formatValueCell(cell, value, metric.format || 'currency', reportingUnit);
          } else {
            cell.value = 'N/A';
            cell.font = { ...this.DATA_FONT, color: { argb: 'FF999999' } };
            cell.alignment = { horizontal: 'right' };
          }
        }
      }

      // Add thin border to all cells
      for (let i = 1; i <= periods.length + 1; i++) {
        row.getCell(i).border = {
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        };
      }

      currentRow++;
    }

    return currentRow;
  }

  /**
   * Format a value cell based on format type and actual reporting unit from SEC filing
   * 
   * The reportingUnit parameter tells us the original scale from the SEC filing:
   * - 'units': Raw numbers (no scaling)
   * - 'thousands': Values in thousands (K)
   * - 'millions': Values in millions (M)
   * - 'billions': Values in billions (B)
   * 
   * Values are stored in full precision (e.g., 383285000000 for $383.285B)
   * We format them using the original reporting unit for consistency with SEC filings
   */
  private formatValueCell(
    cell: ExcelJS.Cell,
    value: number,
    format: 'currency' | 'percentage' | 'number' | 'eps',
    reportingUnit: string = 'units',
  ): void {
    cell.alignment = { horizontal: 'right', vertical: 'middle' };
    cell.font = this.DATA_FONT;

    switch (format) {
      case 'currency':
        // Use actual reporting unit from SEC filing instead of guessing from magnitude
        this.applyCurrencyFormat(cell, value, reportingUnit);
        break;

      case 'percentage':
        // Value is already a decimal (0.25 = 25%)
        if (Math.abs(value) < 1) {
          cell.numFmt = '0.00%';
        } else {
          // Value is already a percentage (25 = 25%)
          cell.value = value / 100;
          cell.numFmt = '0.00%';
        }
        break;

      case 'eps':
        // EPS is always in actual units (dollars per share)
        cell.numFmt = '$#,##0.00';
        break;

      case 'number':
      default:
        // Use actual reporting unit for number formatting
        this.applyNumberFormat(cell, value, reportingUnit);
        break;
    }
  }

  /**
   * Apply currency format based on actual reporting unit from SEC filing
   * 
   * Excel number format codes:
   * - Single comma (,) divides by 1,000
   * - Double comma (,,) divides by 1,000,000
   * - Triple comma (,,,) divides by 1,000,000,000
   */
  private applyCurrencyFormat(
    cell: ExcelJS.Cell,
    value: number,
    reportingUnit: string,
  ): void {
    switch (reportingUnit) {
      case 'billions':
        // Value is in full precision, display in billions
        // e.g., 383285000000 -> $383.3B
        cell.numFmt = '$#,##0.0,,,"B"';
        break;
      case 'millions':
        // Value is in full precision, display in millions
        // e.g., 383285000000 -> $383,285.0M
        cell.numFmt = '$#,##0.0,,"M"';
        break;
      case 'thousands':
        // Value is in full precision, display in thousands
        // e.g., 383285000 -> $383,285.0K
        cell.numFmt = '$#,##0.0,"K"';
        break;
      case 'units':
      default:
        // Fallback: Use magnitude-based formatting for legacy data without reporting_unit
        if (Math.abs(value) >= 1e9) {
          cell.numFmt = '$#,##0.0,,,"B"';
        } else if (Math.abs(value) >= 1e6) {
          cell.numFmt = '$#,##0.0,,"M"';
        } else if (Math.abs(value) >= 1e3) {
          cell.numFmt = '$#,##0.0,"K"';
        } else {
          cell.numFmt = '$#,##0.00';
        }
        break;
    }
  }

  /**
   * Apply number format based on actual reporting unit from SEC filing
   */
  private applyNumberFormat(
    cell: ExcelJS.Cell,
    value: number,
    reportingUnit: string,
  ): void {
    switch (reportingUnit) {
      case 'billions':
        cell.numFmt = '#,##0.0,,,"B"';
        break;
      case 'millions':
        cell.numFmt = '#,##0.0,,"M"';
        break;
      case 'thousands':
        cell.numFmt = '#,##0.0,"K"';
        break;
      case 'units':
      default:
        // Fallback: Use magnitude-based formatting for legacy data
        if (Math.abs(value) >= 1e9) {
          cell.numFmt = '#,##0.0,,,"B"';
        } else if (Math.abs(value) >= 1e6) {
          cell.numFmt = '#,##0.0,,"M"';
        } else {
          cell.numFmt = '#,##0.00';
        }
        break;
    }
  }

  /**
   * Generate 8-K summary workbook
   */
  async generate8KWorkbook(
    filings: Filing8K[],
    options: Options8K,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FundLens';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('8-K Filings');

    // Set column widths
    worksheet.columns = [
      { width: 15 },
      { width: 20 },
      { width: 50 },
    ];

    // Header
    let rowNum = 1;
    const headerRow = worksheet.getRow(rowNum);
    headerRow.getCell(1).value = `${options.companyName} (${options.ticker})`;
    headerRow.getCell(1).font = { bold: true, size: 14 };
    worksheet.mergeCells(rowNum, 1, rowNum, 3);
    rowNum++;

    const subtitleRow = worksheet.getRow(rowNum);
    subtitleRow.getCell(1).value = `8-K Filings: ${options.dateRange.start} to ${options.dateRange.end}`;
    subtitleRow.getCell(1).font = { size: 11, color: { argb: 'FF666666' } };
    worksheet.mergeCells(rowNum, 1, rowNum, 3);
    rowNum += 2;

    // Column headers
    const colHeaderRow = worksheet.getRow(rowNum);
    colHeaderRow.getCell(1).value = 'Filing Date';
    colHeaderRow.getCell(2).value = 'Period';
    colHeaderRow.getCell(3).value = 'Description';

    for (let i = 1; i <= 3; i++) {
      colHeaderRow.getCell(i).fill = this.HEADER_FILL;
      colHeaderRow.getCell(i).font = this.HEADER_FONT;
    }
    rowNum++;

    // Data rows
    for (const filing of filings) {
      const dataRow = worksheet.getRow(rowNum);
      dataRow.getCell(1).value = new Date(filing.filing_date).toLocaleDateString();
      dataRow.getCell(2).value = filing.fiscal_period || 'N/A';
      dataRow.getCell(3).value = '8-K Current Report';
      rowNum++;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Get worksheet name for statement type
   */
  private getWorksheetName(statementType: StatementType): string {
    switch (statementType) {
      case StatementType.INCOME_STATEMENT:
        return 'Income Statement';
      case StatementType.BALANCE_SHEET:
        return 'Balance Sheet';
      case StatementType.CASH_FLOW:
        return 'Cash Flow';
      default:
        return 'Financial Data';
    }
  }

  /**
   * Get statement title
   */
  private getStatementTitle(statementType: StatementType): string {
    switch (statementType) {
      case StatementType.INCOME_STATEMENT:
        return 'Consolidated Statements of Operations';
      case StatementType.BALANCE_SHEET:
        return 'Consolidated Balance Sheets';
      case StatementType.CASH_FLOW:
        return 'Consolidated Statements of Cash Flows';
      default:
        return 'Financial Statement';
    }
  }

  /**
   * Format period header (e.g., "FY2024" -> "FY 2024")
   */
  private formatPeriodHeader(period: string): string {
    // Handle various formats
    if (period.match(/^FY\d{4}$/i)) {
      return period.replace(/FY(\d{4})/i, 'FY $1');
    }
    if (period.match(/^Q\d\s*\d{4}$/i)) {
      return period;
    }
    if (period.match(/^\d{4}$/)) {
      return `FY ${period}`;
    }
    return period;
  }

  /**
   * Generate comp table workbook
   */
  async generateCompTableWorkbook(
    compTableData: any,
    options: { ticker: string; period: string; companies: string[] },
  ): Promise<Buffer> {
    this.logger.log(`Generating comp table workbook for ${options.companies.length} companies`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FundLens';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Comp Table');

    // Set column widths
    const columns: Partial<ExcelJS.Column>[] = [
      { width: 30 }, // Company column
      { width: 15 }, // Ticker column
    ];
    for (let i = 0; i < compTableData.headers.length - 2; i++) {
      columns.push({ width: 18 }); // Metric columns
    }
    worksheet.columns = columns;

    let rowNum = 1;

    // Add title
    const titleRow = worksheet.getRow(rowNum);
    titleRow.getCell(1).value = `Peer Comparison - ${options.period}`;
    titleRow.getCell(1).font = { bold: true, size: 14 };
    worksheet.mergeCells(rowNum, 1, rowNum, compTableData.headers.length);
    rowNum += 2;

    // Add column headers
    const headerRow = worksheet.getRow(rowNum);
    for (let i = 0; i < compTableData.headers.length; i++) {
      const cell = headerRow.getCell(i + 1);
      cell.value = compTableData.headers[i];
      cell.fill = this.HEADER_FILL;
      cell.font = this.HEADER_FONT;
      cell.alignment = { horizontal: i < 2 ? 'left' : 'right', vertical: 'middle' };
    }
    headerRow.height = 22;
    rowNum++;

    // Add data rows
    for (const row of compTableData.rows) {
      const dataRow = worksheet.getRow(rowNum);
      
      // Company name
      dataRow.getCell(1).value = row.companyName;
      dataRow.getCell(1).font = this.DATA_FONT;
      
      // Ticker
      dataRow.getCell(2).value = row.ticker;
      dataRow.getCell(2).font = this.DATA_FONT;

      // Metric values
      let colNum = 3;
      for (const metric of compTableData.headers.slice(2)) {
        const cell = dataRow.getCell(colNum);
        const value = row.values[metric];
        const percentile = row.percentiles[metric];
        const isOutlier = row.outliers.includes(metric);

        if (value !== null && value !== undefined) {
          cell.value = value;
          this.formatValueCell(cell, value, 'currency', 'units');

          // Color code by percentile
          if (percentile !== null && percentile !== undefined) {
            if (percentile >= 75) {
              // Top quartile - green
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFD4EDDA' },
              };
            } else if (percentile <= 25) {
              // Bottom quartile - red
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF8D7DA' },
              };
            }
          }

          // Bold outliers
          if (isOutlier) {
            cell.font = { ...this.DATA_FONT, bold: true };
          }
        } else {
          cell.value = 'N/A';
          cell.font = { ...this.DATA_FONT, color: { argb: 'FF999999' } };
        }

        colNum++;
      }

      rowNum++;
    }

    // Add summary statistics section
    rowNum += 2;
    const summaryTitleRow = worksheet.getRow(rowNum);
    summaryTitleRow.getCell(1).value = 'Summary Statistics';
    summaryTitleRow.getCell(1).font = { bold: true, size: 12 };
    rowNum++;

    // Median row
    const medianRow = worksheet.getRow(rowNum);
    medianRow.getCell(1).value = 'Median';
    medianRow.getCell(1).font = { bold: true };
    let colNum = 3;
    for (const metric of compTableData.headers.slice(2)) {
      const cell = medianRow.getCell(colNum);
      const value = compTableData.summary.median[metric];
      if (value !== null && value !== undefined) {
        cell.value = value;
        this.formatValueCell(cell, value, 'currency', 'units');
      }
      colNum++;
    }
    rowNum++;

    // Mean row
    const meanRow = worksheet.getRow(rowNum);
    meanRow.getCell(1).value = 'Mean';
    meanRow.getCell(1).font = { bold: true };
    colNum = 3;
    for (const metric of compTableData.headers.slice(2)) {
      const cell = meanRow.getCell(colNum);
      const value = compTableData.summary.mean[metric];
      if (value !== null && value !== undefined) {
        cell.value = value;
        this.formatValueCell(cell, value, 'currency', 'units');
      }
      colNum++;
    }
    rowNum++;

    // Percentile rows
    for (const [pLabel, pValue] of [['25th Percentile', 'p25'], ['75th Percentile', 'p75']]) {
      const pRow = worksheet.getRow(rowNum);
      pRow.getCell(1).value = pLabel;
      pRow.getCell(1).font = { bold: true };
      colNum = 3;
      for (const metric of compTableData.headers.slice(2)) {
        const cell = pRow.getCell(colNum);
        const value = compTableData.summary.percentiles[metric]?.[pValue];
        if (value !== null && value !== undefined) {
          cell.value = value;
          this.formatValueCell(cell, value, 'currency', 'units');
        }
        colNum++;
      }
      rowNum++;
    }

    // Freeze panes
    worksheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Generate change tracker workbook
   */
  async generateChangeTrackerWorkbook(
    changeTrackerData: any,
    options: { ticker: string; fromPeriod: string; toPeriod: string },
  ): Promise<Buffer> {
    this.logger.log(`Generating change tracker workbook for ${options.ticker}`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'FundLens';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Changes');

    // Set column widths
    worksheet.columns = [
      { width: 20 }, // Type
      { width: 25 }, // Category
      { width: 50 }, // Description
      { width: 15 }, // Materiality
      { width: 20 }, // From Value
      { width: 20 }, // To Value
      { width: 15 }, // % Change
      { width: 40 }, // Context
    ];

    let rowNum = 1;

    // Add title
    const titleRow = worksheet.getRow(rowNum);
    titleRow.getCell(1).value = `Change Tracker: ${options.fromPeriod} → ${options.toPeriod}`;
    titleRow.getCell(1).font = { bold: true, size: 14 };
    worksheet.mergeCells(rowNum, 1, rowNum, 8);
    rowNum++;

    // Add summary
    const summaryRow = worksheet.getRow(rowNum);
    summaryRow.getCell(1).value = `Total Changes: ${changeTrackerData.summary.total} | High: ${changeTrackerData.summary.byMateriality.high || 0} | Medium: ${changeTrackerData.summary.byMateriality.medium || 0} | Low: ${changeTrackerData.summary.byMateriality.low || 0}`;
    summaryRow.getCell(1).font = { size: 11, color: { argb: 'FF666666' } };
    worksheet.mergeCells(rowNum, 1, rowNum, 8);
    rowNum += 2;

    // Add column headers
    const headerRow = worksheet.getRow(rowNum);
    const headers = ['Type', 'Category', 'Description', 'Materiality', 'From Value', 'To Value', '% Change', 'Context'];
    for (let i = 0; i < headers.length; i++) {
      const cell = headerRow.getCell(i + 1);
      cell.value = headers[i];
      cell.fill = this.HEADER_FILL;
      cell.font = this.HEADER_FONT;
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
    }
    headerRow.height = 22;
    rowNum++;

    // Add data rows
    for (const change of changeTrackerData.changes) {
      const dataRow = worksheet.getRow(rowNum);

      // Type
      dataRow.getCell(1).value = this.formatChangeType(change.type);
      dataRow.getCell(1).font = this.DATA_FONT;

      // Category
      dataRow.getCell(2).value = change.category;
      dataRow.getCell(2).font = this.DATA_FONT;

      // Description
      dataRow.getCell(3).value = change.description;
      dataRow.getCell(3).font = this.DATA_FONT;
      dataRow.getCell(3).alignment = { wrapText: true, vertical: 'top' };

      // Materiality
      const materialityCell = dataRow.getCell(4);
      materialityCell.value = change.materiality.toUpperCase();
      materialityCell.font = { ...this.DATA_FONT, bold: true };
      
      // Color code by materiality
      if (change.materiality === 'high') {
        materialityCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8D7DA' },
        };
        materialityCell.font = { ...materialityCell.font, color: { argb: 'FF721C24' } };
      } else if (change.materiality === 'medium') {
        materialityCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF3CD' },
        };
        materialityCell.font = { ...materialityCell.font, color: { argb: 'FF856404' } };
      } else {
        materialityCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD1ECF1' },
        };
        materialityCell.font = { ...materialityCell.font, color: { argb: 'FF0C5460' } };
      }

      // From Value
      dataRow.getCell(5).value = this.formatChangeValue(change.fromValue);
      dataRow.getCell(5).font = this.DATA_FONT;
      dataRow.getCell(5).alignment = { horizontal: 'right' };

      // To Value
      dataRow.getCell(6).value = this.formatChangeValue(change.toValue);
      dataRow.getCell(6).font = this.DATA_FONT;
      dataRow.getCell(6).alignment = { horizontal: 'right' };

      // % Change
      if (change.percentChange !== null && change.percentChange !== undefined) {
        const pctCell = dataRow.getCell(7);
        pctCell.value = change.percentChange / 100;
        pctCell.numFmt = '0.0%';
        pctCell.font = this.DATA_FONT;
        pctCell.alignment = { horizontal: 'right' };
      }

      // Context
      dataRow.getCell(8).value = change.context;
      dataRow.getCell(8).font = this.DATA_FONT;
      dataRow.getCell(8).alignment = { wrapText: true, vertical: 'top' };

      dataRow.height = 30;
      rowNum++;
    }

    // Freeze panes
    worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 4 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  /**
   * Format change type for display
   */
  private formatChangeType(type: string): string {
    return type
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Format change value for display
   */
  private formatChangeValue(value: any): string {
    if (value === null || value === undefined) return 'N/A';
    if (typeof value === 'number') {
      if (Math.abs(value) >= 1e9) {
        return `$${(value / 1e9).toFixed(2)}B`;
      } else if (Math.abs(value) >= 1e6) {
        return `$${(value / 1e6).toFixed(2)}M`;
      } else if (Math.abs(value) >= 1e3) {
        return `$${(value / 1e3).toFixed(2)}K`;
      }
      return `$${value.toFixed(2)}`;
    }
    if (typeof value === 'string' && value.length > 100) {
      return value.substring(0, 100) + '...';
    }
    return String(value);
  }
}
