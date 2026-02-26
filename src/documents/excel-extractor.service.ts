/**
 * Excel / Financial Model Extractor — Spec §5
 *
 * Programmatic extraction of Excel files using SheetJS.
 * Does NOT use vision — preserves formulas, cell references,
 * named ranges, and sheet structure.
 *
 * Produces:
 *   - Structured metrics with canonical hints
 *   - Financial statement tables
 *   - Formula graph for transparency
 *   - Text chunks for semantic search
 */
import { Injectable, Logger } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ExcelExtractionResult {
  metrics: ExcelMetric[];
  tables: ExcelTable[];
  textChunks: ExcelTextChunk[];
  formulaGraph: FormulaRelation[];
  sheetSummary: SheetSummary[];
}

export interface ExcelMetric {
  metricName: string;
  canonicalHint: string;
  value: number;
  period: string;
  context: 'historical' | 'projected' | 'model_assumption';
  sourceSheet: string;
  sourceCell: string;
  hasFormula: boolean;
  formulaText: string | null;
  unit?: string;
}

export interface ExcelTable {
  tableId: string;
  tableType: string;
  sheetName: string;
  headers: string[];
  rows: { label: string; values: string[]; indentLevel: number; isTotal: boolean }[];
  source: string;
}

export interface ExcelTextChunk {
  content: string;
  sectionType: string;
  sectionHeading: string;
}

export interface FormulaRelation {
  cell: string;
  sheet: string;
  formula: string;
  dependsOn: string[];
}

export interface SheetSummary {
  name: string;
  sheetType: string;
  rowCount: number;
  metricCount: number;
}

// Common financial statement line item → canonical ID mapping
const LABEL_TO_CANONICAL: Record<string, string> = {
  'revenue': 'revenue', 'revenues': 'revenue', 'total revenue': 'revenue',
  'net revenue': 'revenue', 'net revenues': 'revenue', 'net sales': 'revenue',
  'total net revenue': 'revenue', 'sales': 'revenue',
  'cost of revenue': 'cost_of_revenue', 'cost of goods sold': 'cost_of_revenue',
  'cogs': 'cost_of_revenue', 'cost of sales': 'cost_of_revenue',
  'gross profit': 'gross_profit', 'gross margin': 'gross_margin_pct',
  'operating income': 'operating_income', 'operating profit': 'operating_income',
  'income from operations': 'operating_income', 'ebit': 'operating_income',
  'operating expenses': 'operating_expenses', 'total operating expenses': 'operating_expenses',
  'net income': 'net_income', 'net earnings': 'net_income', 'net profit': 'net_income',
  'ebitda': 'ebitda', 'adjusted ebitda': 'ebitda',
  'eps': 'earnings_per_share', 'earnings per share': 'earnings_per_share',
  'diluted eps': 'diluted_eps',
  'total assets': 'total_assets', 'total liabilities': 'total_liabilities',
  'total equity': 'total_equity', 'shareholders equity': 'total_equity',
  'total debt': 'total_debt', 'long-term debt': 'long_term_debt',
  'cash': 'cash_and_cash_equivalents', 'cash and equivalents': 'cash_and_cash_equivalents',
  'free cash flow': 'free_cash_flow', 'fcf': 'free_cash_flow',
  'capex': 'capital_expenditures', 'capital expenditures': 'capital_expenditures',
  'depreciation': 'depreciation_amortization', 'd&a': 'depreciation_amortization',
  'interest expense': 'interest_expense', 'tax expense': 'income_tax_expense',
  'r&d': 'research_and_development', 'research and development': 'research_and_development',
  'sga': 'selling_general_administrative', 'sg&a': 'selling_general_administrative',
  'wacc': 'wacc', 'terminal value': 'terminal_value',
  'enterprise value': 'enterprise_value', 'ev': 'enterprise_value',
  'shares outstanding': 'shares_outstanding',
};

@Injectable()
export class ExcelExtractorService {
  private readonly logger = new Logger(ExcelExtractorService.name);

  /**
   * Extract structured data from an Excel file buffer.
   */
  async extract(
    fileBuffer: Buffer,
    fileName: string,
    ticker?: string,
  ): Promise<ExcelExtractionResult> {
    const startTime = Date.now();
    this.logger.log(`Extracting Excel: ${fileName}`);

    const workbook = XLSX.read(fileBuffer, {
      type: 'buffer',
      cellFormula: true,
      cellStyles: true,
      cellNF: true,
    });

    const result: ExcelExtractionResult = {
      metrics: [],
      tables: [],
      textChunks: [],
      formulaGraph: [],
      sheetSummary: [],
    };

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;

      const sheetType = this.classifySheet(sheetName, sheet);
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
      const rowCount = range.e.r - range.s.r + 1;

      this.logger.log(`  Sheet "${sheetName}": type=${sheetType}, rows=${rowCount}`);

      switch (sheetType) {
        case 'income_statement':
        case 'balance_sheet':
        case 'cash_flow': {
          const extracted = this.extractFinancialStatement(sheet, sheetName, sheetType);
          result.tables.push(extracted.table);
          result.metrics.push(...extracted.metrics);
          break;
        }
        case 'assumptions': {
          const assumptions = this.extractAssumptions(sheet, sheetName);
          result.metrics.push(...assumptions);
          break;
        }
        case 'dcf':
        case 'lbo_returns':
        case 'comps':
        case 'sensitivity': {
          const extracted = this.extractFinancialStatement(sheet, sheetName, sheetType);
          result.tables.push(extracted.table);
          result.metrics.push(...extracted.metrics);
          break;
        }
        default: {
          // Generic: convert to markdown for semantic search
          const md = this.sheetToMarkdown(sheet, sheetName);
          if (md.length > 50) {
            result.textChunks.push({
              content: md,
              sectionType: 'financial_model',
              sectionHeading: sheetName,
            });
          }
        }
      }

      // Extract formula graph from this sheet
      const formulas = this.extractFormulas(sheet, sheetName);
      result.formulaGraph.push(...formulas);

      result.sheetSummary.push({
        name: sheetName,
        sheetType,
        rowCount,
        metricCount: result.metrics.filter(m => m.sourceSheet === sheetName).length,
      });
    }

    this.logger.log(
      `Excel extraction complete: ${result.metrics.length} metrics, ` +
      `${result.tables.length} tables, ${result.formulaGraph.length} formulas ` +
      `(${Date.now() - startTime}ms)`,
    );

    return result;
  }

  /**
   * Classify a sheet by its name and content.
   */
  private classifySheet(name: string, sheet: XLSX.WorkSheet): string {
    const lower = name.toLowerCase().replace(/[^a-z0-9&]/g, '');
    if (/income|p&l|pnl|^pl$|profitloss|incomestatement/.test(lower)) return 'income_statement';
    if (/balance|bs|balancesheet/.test(lower)) return 'balance_sheet';
    if (/dcf|discountedcash|dcfmodel/.test(lower)) return 'dcf';
    if (/cashflow|cf|cash/.test(lower)) return 'cash_flow';
    if (/assumption|inputs|drivers/.test(lower)) return 'assumptions';
    if (/lbo|leveragedbuyout|returns/.test(lower)) return 'lbo_returns';
    if (/comp|comparable|peer|trading/.test(lower)) return 'comps';
    if (/sensitiv|scenario|tornado/.test(lower)) return 'sensitivity';
    if (/summary|overview|dashboard/.test(lower)) return 'summary';
    if (/captable|cap/.test(lower)) return 'cap_table';
    return 'other';
  }

  /**
   * Extract a financial statement sheet into a table + metrics.
   */
  private extractFinancialStatement(
    sheet: XLSX.WorkSheet,
    sheetName: string,
    sheetType: string,
  ): { table: ExcelTable; metrics: ExcelMetric[] } {
    const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null });
    if (data.length < 2) {
      return {
        table: { tableId: `excel_${sheetName}`, tableType: sheetType, sheetName, headers: [], rows: [], source: 'excel_model' },
        metrics: [],
      };
    }

    // Find header row (first row with multiple period-like values)
    let headerIdx = 0;
    const periods: string[] = [];
    for (let i = 0; i < Math.min(data.length, 10); i++) {
      const row = data[i] as any[];
      if (!row) continue;
      const periodCells = row.filter(c => c && /(?:FY|CY|Q[1-4]|20\d{2}|19\d{2})/i.test(String(c)));
      if (periodCells.length >= 2) {
        headerIdx = i;
        // Extract period labels from non-null cells after the label column
        for (let j = 1; j < row.length; j++) {
          if (row[j]) periods.push(String(row[j]).trim());
        }
        break;
      }
    }

    // If no period headers found, use column indices
    if (periods.length === 0) {
      const firstRow = data[0] as any[];
      if (firstRow) {
        for (let j = 1; j < firstRow.length; j++) {
          periods.push(firstRow[j] ? String(firstRow[j]).trim() : `Col${j}`);
        }
      }
      headerIdx = 0;
    }

    const metrics: ExcelMetric[] = [];
    const tableRows: ExcelTable['rows'][0][] = [];

    // Extract data rows
    for (let i = headerIdx + 1; i < data.length; i++) {
      const row = data[i] as any[];
      if (!row || !row[0]) continue;

      const label = String(row[0]).trim();
      if (!label || label.length > 200) continue;

      const values: string[] = [];
      for (let j = 1; j < Math.min(row.length, periods.length + 1); j++) {
        values.push(row[j] != null ? String(row[j]) : '');
      }

      // Detect indent level from leading spaces
      const rawLabel = String(row[0]);
      const indentLevel = Math.floor((rawLabel.length - rawLabel.trimStart().length) / 2);
      const isTotal = /^total\b/i.test(label) || /\btotal$/i.test(label);

      tableRows.push({ label, values, indentLevel, isTotal });

      // Extract numeric metrics
      const canonicalHint = this.guessCanonicalId(label);
      for (let j = 0; j < values.length; j++) {
        const numVal = this.parseNumeric(values[j]);
        if (numVal === null) continue;

        const period = periods[j] || `Col${j + 1}`;
        const isProjected = /E$|est|proj|forecast/i.test(period);
        const cellRef = `${XLSX.utils.encode_col(j + 1)}${i + 1}`;

        // Check if cell has a formula
        const cellAddr = XLSX.utils.encode_cell({ r: i, c: j + 1 });
        const cell = sheet[cellAddr];
        const hasFormula = !!(cell && cell.f);

        metrics.push({
          metricName: label,
          canonicalHint,
          value: numVal,
          period,
          context: isProjected ? 'projected' : 'historical',
          sourceSheet: sheetName,
          sourceCell: cellRef,
          hasFormula,
          formulaText: hasFormula ? cell.f : null,
        });
      }
    }

    return {
      table: {
        tableId: `excel_${sheetName}`,
        tableType: sheetType,
        sheetName,
        headers: ['Line Item', ...periods],
        rows: tableRows,
        source: 'excel_model',
      },
      metrics,
    };
  }

  /**
   * Extract assumptions from a sheet (key-value pairs).
   */
  private extractAssumptions(sheet: XLSX.WorkSheet, sheetName: string): ExcelMetric[] {
    const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null });
    const metrics: ExcelMetric[] = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i] as any[];
      if (!row || !row[0]) continue;

      const label = String(row[0]).trim();
      // Look for label + value pairs
      for (let j = 1; j < row.length; j++) {
        const numVal = this.parseNumeric(String(row[j] ?? ''));
        if (numVal === null) continue;

        metrics.push({
          metricName: label,
          canonicalHint: this.guessCanonicalId(label),
          value: numVal,
          period: 'assumption',
          context: 'model_assumption',
          sourceSheet: sheetName,
          sourceCell: `${XLSX.utils.encode_col(j)}${i + 1}`,
          hasFormula: false,
          formulaText: null,
        });
        break; // Take first numeric value per row
      }
    }

    return metrics;
  }

  /**
   * Extract formula relationships from a sheet.
   */
  private extractFormulas(sheet: XLSX.WorkSheet, sheetName: string): FormulaRelation[] {
    const formulas: FormulaRelation[] = [];
    const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    if (!range) return formulas;

    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = sheet[addr];
        if (cell && cell.f) {
          // Extract cell references from formula
          const refs = cell.f.match(/[A-Z]+\d+/g) || [];
          formulas.push({
            cell: addr,
            sheet: sheetName,
            formula: cell.f,
            dependsOn: refs.map(ref => `${sheetName}!${ref}`),
          });
        }
      }
    }

    return formulas;
  }

  /**
   * Convert a sheet to markdown for semantic search.
   */
  private sheetToMarkdown(sheet: XLSX.WorkSheet, sheetName: string): string {
    const data = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: '' });
    const lines: string[] = [`## ${sheetName}\n`];

    for (const row of data) {
      const cells = (row as any[]).map(c => String(c ?? '').trim());
      if (cells.every(c => !c)) continue;
      lines.push(`| ${cells.join(' | ')} |`);
    }

    return lines.join('\n');
  }

  /**
   * Guess canonical metric ID from a label.
   */
  private guessCanonicalId(label: string): string {
    const normalized = label.toLowerCase().trim()
      .replace(/[()]/g, '')
      .replace(/\s+/g, ' ');
    return LABEL_TO_CANONICAL[normalized] || label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  }

  /**
   * Parse a string to a numeric value, handling currency formatting.
   */
  private parseNumeric(val: string): number | null {
    if (!val || val.trim() === '' || val === '-' || val === 'N/A' || val === 'n/a') return null;
    // Remove currency symbols, commas, spaces
    let cleaned = val.replace(/[$€£¥,\s]/g, '').trim();
    // Handle parentheses as negative
    const isNeg = cleaned.startsWith('(') && cleaned.endsWith(')');
    if (isNeg) cleaned = cleaned.slice(1, -1);
    // Remove % and x suffixes
    cleaned = cleaned.replace(/[%x]$/i, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    return isNeg ? -num : num;
  }
}
