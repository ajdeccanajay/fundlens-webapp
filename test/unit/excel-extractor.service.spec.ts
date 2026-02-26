import { ExcelExtractorService } from '../../src/documents/excel-extractor.service';
import * as XLSX from 'xlsx';

describe('ExcelExtractorService', () => {
  let service: ExcelExtractorService;

  beforeEach(() => {
    service = new ExcelExtractorService();
  });

  function buildExcelBuffer(sheets: Record<string, any[][]>): Buffer {
    const wb = XLSX.utils.book_new();
    for (const [name, data] of Object.entries(sheets)) {
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  it('should extract metrics from an income statement sheet', async () => {
    const buf = buildExcelBuffer({
      'Income Statement': [
        ['', 'FY2022', 'FY2023', 'FY2024'],
        ['Revenue', 100000, 120000, 140000],
        ['Cost of Revenue', 60000, 70000, 80000],
        ['Gross Profit', 40000, 50000, 60000],
        ['Operating Income', 15000, 20000, 25000],
        ['Net Income', 10000, 14000, 18000],
      ],
    });

    const result = await service.extract(buf, 'model.xlsx', 'AAPL');

    // Should have metrics for each cell
    expect(result.metrics.length).toBeGreaterThanOrEqual(15); // 5 rows × 3 periods
    expect(result.tables.length).toBe(1);
    expect(result.tables[0].tableType).toBe('income_statement');
    expect(result.tables[0].headers).toContain('FY2022');

    // Check canonical hints
    const revenueMetrics = result.metrics.filter(m => m.canonicalHint === 'revenue');
    expect(revenueMetrics.length).toBe(3);
    expect(revenueMetrics[0].value).toBe(100000);
    expect(revenueMetrics[1].value).toBe(120000);
    expect(revenueMetrics[2].value).toBe(140000);

    const netIncomeMetrics = result.metrics.filter(m => m.canonicalHint === 'net_income');
    expect(netIncomeMetrics.length).toBe(3);
  });

  it('should classify sheets correctly', async () => {
    const buf = buildExcelBuffer({
      'P&L': [['', 'FY2023'], ['Revenue', 100]],
      'Balance Sheet': [['', 'FY2023'], ['Total Assets', 500]],
      'Cash Flow': [['', 'FY2023'], ['Free Cash Flow', 50]],
      'Assumptions': [['Growth Rate', 0.05]],
      'DCF Model': [['', 'FY2023'], ['WACC', 0.10]],
      'Comps': [['', 'FY2023'], ['EV/EBITDA', 12]],
      'Random Notes': [['Some text here']],
    });

    const result = await service.extract(buf, 'model.xlsx');

    expect(result.sheetSummary.length).toBe(7);
    const types = result.sheetSummary.map(s => s.sheetType);
    expect(types).toContain('income_statement');
    expect(types).toContain('balance_sheet');
    expect(types).toContain('cash_flow');
    expect(types).toContain('assumptions');
    expect(types).toContain('dcf');
    expect(types).toContain('comps');
    expect(types).toContain('other');
  });

  it('should extract assumptions as model_assumption context', async () => {
    const buf = buildExcelBuffer({
      'Assumptions': [
        ['Revenue Growth', 0.08],
        ['Tax Rate', 0.21],
        ['WACC', 0.10],
      ],
    });

    const result = await service.extract(buf, 'model.xlsx');
    const assumptions = result.metrics.filter(m => m.context === 'model_assumption');
    expect(assumptions.length).toBe(3);
    expect(assumptions[0].metricName).toBe('Revenue Growth');
    expect(assumptions[0].value).toBe(0.08);
  });

  it('should detect projected periods', async () => {
    const buf = buildExcelBuffer({
      'Income Statement': [
        ['', 'FY2023', 'FY2024E', 'FY2025E'],
        ['Revenue', 100, 110, 120],
      ],
    });

    const result = await service.extract(buf, 'model.xlsx');
    const historical = result.metrics.filter(m => m.context === 'historical');
    const projected = result.metrics.filter(m => m.context === 'projected');
    expect(historical.length).toBe(1);
    expect(projected.length).toBe(2);
  });

  it('should extract formula graph', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['', 'FY2023'],
      ['Revenue', 100],
      ['COGS', 60],
      ['Gross Profit', 40],
    ]);
    // Manually add a formula cell — must set on the existing cell
    ws['B4'] = { t: 'n', v: 40, f: 'B2-B3' };
    XLSX.utils.book_append_sheet(wb, ws, 'Income Statement');
    // Write with bookType xlsx and read back with cellFormula: true
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const result = await service.extract(buf, 'model.xlsx');
    // SheetJS preserves formulas in xlsx format
    expect(result.formulaGraph.length).toBeGreaterThanOrEqual(1);
    const formulaEntry = result.formulaGraph.find(f => f.formula === 'B2-B3');
    expect(formulaEntry).toBeDefined();
    expect(formulaEntry!.dependsOn).toContain('Income Statement!B2');
    expect(formulaEntry!.dependsOn).toContain('Income Statement!B3');
  });

  it('should handle negative values in parentheses', async () => {
    const buf = buildExcelBuffer({
      'Income Statement': [
        ['', 'FY2023'],
        ['Net Loss', '(5000)'],
      ],
    });

    const result = await service.extract(buf, 'model.xlsx');
    // The parenthesized value should be parsed as negative
    const netLoss = result.metrics.find(m => m.metricName === 'Net Loss');
    expect(netLoss).toBeDefined();
    expect(netLoss!.value).toBe(-5000);
  });

  it('should generate text chunks for unclassified sheets', async () => {
    const buf = buildExcelBuffer({
      'Meeting Notes': [
        ['Discussion Topic', 'Notes'],
        ['Revenue outlook', 'Management expects 10% growth'],
        ['Margin expansion', 'Targeting 200bps improvement'],
      ],
    });

    const result = await service.extract(buf, 'model.xlsx');
    expect(result.textChunks.length).toBe(1);
    expect(result.textChunks[0].sectionHeading).toBe('Meeting Notes');
    expect(result.textChunks[0].content).toContain('Revenue outlook');
  });

  it('should handle empty workbook gracefully', async () => {
    const buf = buildExcelBuffer({ 'Empty': [[]] });
    const result = await service.extract(buf, 'empty.xlsx');
    expect(result.metrics.length).toBe(0);
    expect(result.tables.length).toBe(0);
  });

  it('should map common labels to canonical IDs', async () => {
    const buf = buildExcelBuffer({
      'Income Statement': [
        ['', 'FY2023'],
        ['Net Sales', 100],
        ['Cost of Goods Sold', 60],
        ['SG&A', 20],
        ['EBITDA', 30],
        ['Diluted EPS', 2.5],
        ['Free Cash Flow', 15],
      ],
    });

    const result = await service.extract(buf, 'model.xlsx');
    const hints = result.metrics.map(m => m.canonicalHint);
    expect(hints).toContain('revenue');           // Net Sales → revenue
    expect(hints).toContain('cost_of_revenue');   // Cost of Goods Sold → cost_of_revenue
    expect(hints).toContain('selling_general_administrative'); // SG&A
    expect(hints).toContain('ebitda');
    expect(hints).toContain('diluted_eps');
    expect(hints).toContain('free_cash_flow');
  });
});
