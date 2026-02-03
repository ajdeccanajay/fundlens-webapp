import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ExportRequest,
  Export8KRequest,
  AvailablePeriodsResponse,
  ExportOptions,
  StatementType,
  FilingType,
  ExportMode,
  StatementData,
  MetricRow,
  ExportResult,
  RawFinancialMetric,
  IndustryType,
} from './export.types';
import { StatementMapper } from './statement-mapper';
import { XLSXGenerator } from './xlsx-generator';

// ============================================================
// GICS SECTOR TICKER MAPPINGS
// Global Industry Classification Standard (GICS) - 11 Sectors
// https://www.msci.com/our-solutions/indexes/gics
// ============================================================

// GICS 10 - Energy
const ENERGY_TICKERS = [
  'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX', 'VLO', 'OXY', 'PXD',
  'HES', 'DVN', 'HAL', 'BKR', 'FANG', 'MRO', 'APA', 'CTRA', 'OVV', 'EQT',
];

// GICS 15 - Materials
const MATERIALS_TICKERS = [
  'LIN', 'APD', 'SHW', 'ECL', 'FCX', 'NEM', 'NUE', 'DOW', 'DD', 'PPG',
  'VMC', 'MLM', 'ALB', 'CTVA', 'IFF', 'CE', 'EMN', 'PKG', 'IP', 'AVY',
];

// GICS 20 - Industrials
const INDUSTRIALS_TICKERS = [
  'UNP', 'HON', 'UPS', 'RTX', 'CAT', 'DE', 'BA', 'LMT', 'GE', 'MMM',
  'GD', 'NOC', 'ITW', 'EMR', 'ETN', 'PH', 'CTAS', 'JCI', 'CSX', 'NSC',
  'WM', 'RSG', 'PCAR', 'CMI', 'FAST', 'ODFL', 'TT', 'ROK', 'AME', 'IR',
];

// GICS 25 - Consumer Discretionary
const CONSUMER_DISCRETIONARY_TICKERS = [
  'AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'LOW', 'SBUX', 'TJX', 'BKNG', 'MAR',
  'ORLY', 'AZO', 'CMG', 'DHI', 'LEN', 'GM', 'F', 'ROST', 'YUM', 'DG',
  'DLTR', 'EBAY', 'APTV', 'BBY', 'GRMN', 'POOL', 'PHM', 'NVR', 'CCL', 'RCL',
];

// GICS 30 - Consumer Staples
const CONSUMER_STAPLES_TICKERS = [
  'PG', 'KO', 'PEP', 'COST', 'WMT', 'PM', 'MO', 'MDLZ', 'CL', 'EL',
  'KMB', 'GIS', 'KHC', 'SYY', 'STZ', 'ADM', 'MKC', 'HSY', 'K', 'CAG',
  'KR', 'WBA', 'TSN', 'HRL', 'CPB', 'SJM', 'CLX', 'CHD', 'BF.B', 'TAP',
];

// GICS 35 - Health Care
const HEALTH_CARE_TICKERS = [
  'UNH', 'JNJ', 'LLY', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY',
  'AMGN', 'MDT', 'ELV', 'GILD', 'CVS', 'CI', 'ISRG', 'VRTX', 'REGN', 'SYK',
  'ZTS', 'BDX', 'BSX', 'HUM', 'MCK', 'HCA', 'MRNA', 'BIIB', 'IQV', 'IDXX',
];

// GICS 40 - Financials (Banks, Insurance, Diversified Financials)
const FINANCIALS_TICKERS = [
  // Banks
  'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC', 'COF',
  'SCHW', 'BK', 'STT', 'FITB', 'RF', 'HBAN', 'CFG', 'KEY', 'NTRS', 'MTB',
  // Insurance
  'BRK.A', 'BRK.B', 'MET', 'PRU', 'AIG', 'ALL', 'TRV', 'PGR', 'AFL', 'HIG',
  'AJG', 'MMC', 'AON', 'CB', 'CINF', 'L', 'LNC', 'GL', 'UNM', 'AIZ',
  // Diversified Financials
  'AXP', 'BLK', 'SPGI', 'ICE', 'CME', 'MCO', 'MSCI', 'NDAQ', 'FIS', 'FISV',
  'V', 'MA', 'PYPL', 'SQ', 'DFS', 'COF', 'AMP', 'RJF', 'TROW', 'IVZ',
];

// GICS 45 - Information Technology
const INFORMATION_TECHNOLOGY_TICKERS = [
  'AAPL', 'MSFT', 'NVDA', 'AVGO', 'CSCO', 'ADBE', 'CRM', 'ACN', 'ORCL', 'INTC',
  'AMD', 'TXN', 'QCOM', 'IBM', 'INTU', 'NOW', 'AMAT', 'ADI', 'LRCX', 'MU',
  'KLAC', 'SNPS', 'CDNS', 'MCHP', 'FTNT', 'PANW', 'CRWD', 'ZS', 'TEAM', 'WDAY',
  'ADSK', 'ANSS', 'CTSH', 'IT', 'HPQ', 'HPE', 'DELL', 'WDC', 'STX', 'NTAP',
];

// GICS 50 - Communication Services (Media, Telecom, Interactive Media)
const COMMUNICATION_SERVICES_TICKERS = [
  // Media & Entertainment
  'CMCSA', 'DIS', 'NFLX', 'WBD', 'PARA', 'FOX', 'FOXA', 'VIAC', 'LYV', 'ROKU',
  'SPOT', 'MTCH', 'EA', 'TTWO', 'ATVI', 'OMC', 'IPG', 'NWSA', 'NWS',
  // Telecom
  'T', 'VZ', 'TMUS', 'LUMN', 'CHTR', 'FYBR',
  // Interactive Media & Services
  'GOOGL', 'GOOG', 'META', 'SNAP', 'PINS', 'TWTR', 'ZG', 'Z', 'IAC', 'ANGI',
];

// GICS 55 - Utilities
const UTILITIES_TICKERS = [
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'ED', 'WEC',
  'ES', 'DTE', 'PEG', 'EIX', 'AWK', 'AEE', 'CMS', 'CNP', 'FE', 'ETR',
  'PPL', 'EVRG', 'AES', 'LNT', 'NI', 'ATO', 'NRG', 'PNW', 'OGE', 'BKH',
];

// GICS 60 - Real Estate (REITs and Real Estate Management)
const REAL_ESTATE_TICKERS = [
  'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'SPG', 'O', 'WELL', 'DLR', 'AVB',
  'EQR', 'VTR', 'ARE', 'MAA', 'UDR', 'ESS', 'PEAK', 'HST', 'KIM', 'REG',
  'BXP', 'VNO', 'SLG', 'CBRE', 'JLL', 'CSGP', 'EXR', 'CUBE', 'LSI', 'IRM',
];

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly statementMapper: StatementMapper,
    private readonly xlsxGenerator: XLSXGenerator,
  ) {}

  /**
   * Detect GICS sector based on ticker
   * Used to include industry-specific metrics in exports for 10-K, 10-Q, and 8-K
   */
  private async detectIndustry(ticker: string): Promise<IndustryType | undefined> {
    const upperTicker = ticker.toUpperCase();
    
    if (ENERGY_TICKERS.includes(upperTicker)) return 'energy';
    if (MATERIALS_TICKERS.includes(upperTicker)) return 'materials';
    if (INDUSTRIALS_TICKERS.includes(upperTicker)) return 'industrials';
    if (CONSUMER_DISCRETIONARY_TICKERS.includes(upperTicker)) return 'consumer_discretionary';
    if (CONSUMER_STAPLES_TICKERS.includes(upperTicker)) return 'consumer_staples';
    if (HEALTH_CARE_TICKERS.includes(upperTicker)) return 'health_care';
    if (FINANCIALS_TICKERS.includes(upperTicker)) return 'financials';
    if (INFORMATION_TECHNOLOGY_TICKERS.includes(upperTicker)) return 'information_technology';
    if (COMMUNICATION_SERVICES_TICKERS.includes(upperTicker)) return 'communication_services';
    if (UTILITIES_TICKERS.includes(upperTicker)) return 'utilities';
    if (REAL_ESTATE_TICKERS.includes(upperTicker)) return 'real_estate';
    
    // Could also detect based on metrics in DB or external API
    // For now, return undefined for companies not in our mapping
    return undefined;
  }

  /**
   * Generate Excel export based on request options
   */
  async generateExcelExport(
    dealId: string,
    request: ExportRequest,
  ): Promise<ExportResult> {
    this.logger.log(`Generating Excel export for deal ${dealId}`);

    // Get deal info
    const deal = await this.getDealInfo(dealId);
    if (!deal) {
      throw new Error('No deal found');
    }

    const options: ExportOptions = {
      ticker: deal.ticker,
      companyName: deal.companyName || deal.ticker,
      filingType: request.filingType,
      exportMode: request.exportMode || ExportMode.ANNUAL,
      years: request.years,
      quarters: request.quarters,
      statements: request.statements,
      includeCalculatedMetrics: request.includeCalculatedMetrics ?? true,
    };

    let buffer: Buffer;

    switch (options.exportMode) {
      case ExportMode.QUARTERLY:
        buffer = await this.generateQuarterlyExport(options);
        break;
      case ExportMode.COMBINED:
        buffer = await this.generateCombinedExport(options);
        break;
      case ExportMode.ANNUAL:
      default:
        buffer = await this.generateAnnualExport(options);
        break;
    }

    const filename = this.generateFilename(options);

    return { buffer, filename };
  }

  /**
   * Generate Excel export by ticker (for comprehensive-financial-analysis.html)
   */
  async generateExcelExportByTicker(
    ticker: string,
    request: ExportRequest,
  ): Promise<ExportResult> {
    this.logger.log(`Generating Excel export for ticker ${ticker}`);

    const upperTicker = ticker.toUpperCase();

    // Use ticker as company name since company_name column may not exist
    const companyName = upperTicker;

    const options: ExportOptions = {
      ticker: upperTicker,
      companyName,
      filingType: request.filingType,
      exportMode: request.exportMode || ExportMode.ANNUAL,
      years: request.years,
      quarters: request.quarters,
      statements: request.statements,
      includeCalculatedMetrics: request.includeCalculatedMetrics ?? true,
    };

    let buffer: Buffer;

    switch (options.exportMode) {
      case ExportMode.QUARTERLY:
        buffer = await this.generateQuarterlyExport(options);
        break;
      case ExportMode.COMBINED:
        buffer = await this.generateCombinedExport(options);
        break;
      case ExportMode.ANNUAL:
      default:
        buffer = await this.generateAnnualExport(options);
        break;
    }

    const filename = this.generateFilename(options);

    return { buffer, filename };
  }

  /**
   * Get available fiscal periods for a deal
   */
  async getAvailablePeriods(dealId: string): Promise<AvailablePeriodsResponse> {
    const deal = await this.getDealInfo(dealId);
    if (!deal) {
      throw new Error('No deal found');
    }

    return this.getAvailablePeriodsByTicker(deal.ticker);
  }

  /**
   * Get available fiscal periods by ticker (for comprehensive-financial-analysis.html)
   */
  async getAvailablePeriodsByTicker(ticker: string): Promise<AvailablePeriodsResponse> {
    const upperTicker = ticker.toUpperCase();

    // Get distinct annual periods (10-K)
    const annualResult = await this.prisma.$queryRawUnsafe<{ fiscal_period: string }[]>(`
      SELECT DISTINCT fiscal_period
      FROM financial_metrics
      WHERE ticker = $1 AND filing_type = '10-K'
      ORDER BY fiscal_period DESC
    `, upperTicker);

    const annualPeriods = annualResult.map(r => r.fiscal_period);

    // Get quarterly periods (10-Q) grouped by year
    const quarterlyResult = await this.prisma.$queryRawUnsafe<{ fiscal_period: string }[]>(`
      SELECT DISTINCT fiscal_period
      FROM financial_metrics
      WHERE ticker = $1 AND filing_type = '10-Q'
      ORDER BY fiscal_period DESC
    `, upperTicker);

    // Group quarters by year
    const quartersByYear: Record<string, string[]> = {};
    for (const r of quarterlyResult) {
      const period = r.fiscal_period;
      // Extract year from period like "Q1 2024" or "2024-Q1"
      const yearMatch = period.match(/(\d{4})/);
      if (yearMatch) {
        const year = yearMatch[1];
        if (!quartersByYear[year]) {
          quartersByYear[year] = [];
        }
        quartersByYear[year].push(period);
      }
    }

    const quarterlyPeriods = Object.entries(quartersByYear)
      .map(([year, quarters]) => ({ year, quarters }))
      .sort((a, b) => b.year.localeCompare(a.year));

    // Check for 8-K filings
    const eightKResult = await this.prisma.$queryRawUnsafe<{ min_date: Date; max_date: Date; count: number }[]>(`
      SELECT MIN(filing_date) as min_date, MAX(filing_date) as max_date, COUNT(*) as count
      FROM financial_metrics
      WHERE ticker = $1 AND filing_type = '8-K'
    `, upperTicker);

    const has8KFilings = eightKResult[0]?.count > 0;

    return {
      annualPeriods,
      quarterlyPeriods,
      has8KFilings,
      earliest8KDate: has8KFilings ? eightKResult[0].min_date?.toISOString().split('T')[0] : undefined,
      latest8KDate: has8KFilings ? eightKResult[0].max_date?.toISOString().split('T')[0] : undefined,
    };
  }

  /**
   * Generate annual (10-K) export
   */
  async generateAnnualExport(options: ExportOptions): Promise<Buffer> {
    this.logger.log(`Generating annual export for ${options.ticker}: years=${options.years.join(',')}`);

    // Validate ticker has data
    await this.validateTickerHasData(options.ticker, FilingType.TEN_K);

    // Detect industry type for industry-specific metrics
    const industry = await this.detectIndustry(options.ticker);
    this.logger.log(`Detected industry for ${options.ticker}: ${industry || 'generic'}`);

    const statementDataList: StatementData[] = [];

    for (const statementType of options.statements) {
      const metrics = await this.fetchMetricsForStatement(
        options.ticker,
        FilingType.TEN_K,
        options.years,
        statementType,
      );

      if (metrics.length === 0) {
        throw new Error(
          `No ${statementType.replace('_', ' ')} data found for ${options.ticker} (${FilingType.TEN_K}). ` +
          `Please check if the company has filed financial statements for the requested periods: ${options.years.join(', ')}.`
        );
      }

      // Use mapMetricsToStatementWithDiscovery to include industry-specific and dynamically discovered metrics
      const mappedMetrics = this.statementMapper.mapMetricsToStatementWithDiscovery(
        metrics,
        statementType,
        options.years,
        industry,
      );

      statementDataList.push({
        statementType,
        filingType: FilingType.TEN_K,
        periods: options.years,
        metrics: mappedMetrics,
      });
    }

    return this.xlsxGenerator.generateWorkbook(statementDataList, {
      companyName: options.companyName,
      ticker: options.ticker,
      filingType: '10-K Annual',
    });
  }

  /**
   * Generate quarterly (10-Q) export
   */
  async generateQuarterlyExport(options: ExportOptions): Promise<Buffer> {
    const year = options.years[0]; // For quarterly, we use the first year
    const quarters = options.quarters || ['Q1', 'Q2', 'Q3', 'Q4'];
    
    this.logger.log(`Generating quarterly export for ${options.ticker}: year=${year}, quarters=${quarters.join(',')}`);

    // Validate ticker has data
    await this.validateTickerHasData(options.ticker, FilingType.TEN_Q);

    // Detect industry type for industry-specific metrics
    const industry = await this.detectIndustry(options.ticker);

    // Build period strings like "Q1 2024", "Q2 2024", etc.
    const periods = quarters.map(q => `${q} ${year}`);

    const statementDataList: StatementData[] = [];

    for (const statementType of options.statements) {
      const metrics = await this.fetchMetricsForStatement(
        options.ticker,
        FilingType.TEN_Q,
        periods,
        statementType,
      );

      if (metrics.length === 0) {
        throw new Error(
          `No ${statementType.replace('_', ' ')} data found for ${options.ticker} (${FilingType.TEN_Q}). ` +
          `Please check if the company has filed quarterly statements for ${year} ${quarters.join(', ')}.`
        );
      }

      // Use mapMetricsToStatementWithDiscovery to include industry-specific and dynamically discovered metrics
      const mappedMetrics = this.statementMapper.mapMetricsToStatementWithDiscovery(
        metrics,
        statementType,
        periods,
        industry,
      );

      statementDataList.push({
        statementType,
        filingType: FilingType.TEN_Q,
        periods,
        metrics: mappedMetrics,
      });
    }

    return this.xlsxGenerator.generateWorkbook(statementDataList, {
      companyName: options.companyName,
      ticker: options.ticker,
      filingType: `10-Q Quarterly - ${year}`,
    });
  }

  /**
   * Generate combined (10-K + 10-Q) export
   */
  async generateCombinedExport(options: ExportOptions): Promise<Buffer> {
    this.logger.log(`Generating combined export for ${options.ticker}`);

    // Generate both annual and quarterly data
    const annualData = await this.generateAnnualExport(options);
    
    // For combined, we'd create separate worksheets - simplified for now
    return annualData;
  }

  /**
   * Generate 8-K export
   */
  async generate8KExport(
    dealId: string,
    request: Export8KRequest,
  ): Promise<ExportResult> {
    const deal = await this.getDealInfo(dealId);
    if (!deal) {
      throw new Error('No deal found');
    }

    return this.generate8KExportByTicker(deal.ticker, request);
  }

  /**
   * Generate 8-K export by ticker (for comprehensive-financial-analysis.html)
   */
  async generate8KExportByTicker(
    ticker: string,
    request: Export8KRequest,
  ): Promise<ExportResult> {
    const upperTicker = ticker.toUpperCase();
    
    this.logger.log(`Generating 8-K export for ${upperTicker}: ${request.startDate} to ${request.endDate}`);

    // Query 8-K filings in date range
    const filings = await this.prisma.$queryRawUnsafe<any[]>(`
      SELECT DISTINCT filing_date, fiscal_period
      FROM financial_metrics
      WHERE ticker = $1 
        AND filing_type = '8-K'
        AND filing_date >= $2
        AND filing_date <= $3
      ORDER BY filing_date DESC
    `, upperTicker, new Date(request.startDate), new Date(request.endDate));

    if (filings.length === 0) {
      throw new Error('No 8-K filings found in the specified date range');
    }

    // Generate 8-K summary workbook
    const buffer = await this.xlsxGenerator.generate8KWorkbook(filings, {
      companyName: upperTicker,
      ticker: upperTicker,
      dateRange: { start: request.startDate, end: request.endDate },
    });

    const filename = `${upperTicker}_8K_${request.startDate}_to_${request.endDate}.xlsx`;

    return { buffer, filename };
  }


  /**
   * Fetch metrics for a specific statement type
   */
  private async fetchMetricsForStatement(
    ticker: string,
    filingType: FilingType,
    periods: string[],
    statementType: StatementType,
  ): Promise<RawFinancialMetric[]> {
    const upperTicker = ticker.toUpperCase();

    // Build period filter - handle both "FY2024" and "2024" formats
    // Parameters: $1=ticker, $2=filingType, $3=statementType, $4+...=periods
    const periodConditions = periods.map((_, i) => `fiscal_period ILIKE $${i + 4}`);
    const periodParams = periods.map(p => {
      // Ensure p is a string and remove 'FY' prefix if present
      const periodStr = String(p);
      return `%${periodStr.replace('FY', '')}%`;
    });

    const query = `
      SELECT 
        id, ticker, normalized_metric, raw_label, value, reporting_unit,
        fiscal_period, period_type, filing_type, statement_type,
        filing_date, confidence_score
      FROM financial_metrics
      WHERE ticker = $1 
        AND filing_type = $2
        AND statement_type = $3
        AND (${periodConditions.join(' OR ')})
      ORDER BY fiscal_period DESC, filing_date DESC
    `;

    const metrics = await this.prisma.$queryRawUnsafe<RawFinancialMetric[]>(
      query,
      upperTicker,
      filingType,
      statementType,
      ...periodParams,
    );

    this.logger.log(`Fetched ${metrics.length} metrics for ${upperTicker} ${statementType} ${filingType}`);

    // Deduplicate - keep most recent filing_date for each metric/period combo
    const deduped = this.deduplicateMetrics(metrics);

    return deduped;
  }

  /**
   * Deduplicate metrics - keep most recent filing_date for each metric/period
   * Also converts Prisma Decimal values to JavaScript numbers
   */
  private deduplicateMetrics(metrics: RawFinancialMetric[]): RawFinancialMetric[] {
    const seen = new Map<string, RawFinancialMetric>();

    for (const metric of metrics) {
      const key = `${metric.normalized_metric}|${metric.fiscal_period}`;
      const existing = seen.get(key);

      if (!existing || new Date(metric.filing_date) > new Date(existing.filing_date)) {
        // Convert Prisma Decimal (returned as string from raw queries) to number
        seen.set(key, {
          ...metric,
          value: metric.value !== null && metric.value !== undefined 
            ? Number(metric.value) 
            : 0,
          reporting_unit: metric.reporting_unit || 'units',  // Default to 'units' if not set
        });
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Get deal information
   */
  private async getDealInfo(dealId: string): Promise<{ ticker: string; companyName: string } | null> {
    try {
      const deal = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT ticker, company_name as "companyName"
        FROM deals
        WHERE id = $1
      `, dealId);

      return deal[0] || null;
    } catch (error) {
      this.logger.error(`Failed to get deal info: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate that a ticker has financial data in the database
   * Throws user-friendly error if no data found
   */
  private async validateTickerHasData(ticker: string, filingType: FilingType): Promise<void> {
    const upperTicker = ticker.toUpperCase();

    // Check if ticker exists in database
    const result = await this.prisma.$queryRawUnsafe<{ count: number }[]>(`
      SELECT COUNT(*)::int as count
      FROM financial_metrics
      WHERE ticker = $1
      LIMIT 1
    `, upperTicker);

    const hasAnyData = result[0]?.count > 0;

    if (!hasAnyData) {
      throw new Error(
        `Company "${upperTicker}" not found in our database. ` +
        `Please verify the ticker symbol is correct. ` +
        `If this is a valid company, financial data may need to be imported first.`
      );
    }

    // Check if ticker has data for the specific filing type
    const filingResult = await this.prisma.$queryRawUnsafe<{ count: number }[]>(`
      SELECT COUNT(*)::int as count
      FROM financial_metrics
      WHERE ticker = $1 AND filing_type = $2
      LIMIT 1
    `, upperTicker, filingType);

    const hasFilingData = filingResult[0]?.count > 0;

    if (!hasFilingData) {
      const filingTypeName = filingType === FilingType.TEN_K ? 'annual (10-K)' : 
                             filingType === FilingType.TEN_Q ? 'quarterly (10-Q)' : '8-K';
      throw new Error(
        `No ${filingTypeName} filings found for "${upperTicker}". ` +
        `The company may only have ${filingType === FilingType.TEN_K ? 'quarterly' : 'annual'} data available. ` +
        `Please try a different filing type or check if data needs to be imported.`
      );
    }
  }

  /**
   * Generate filename for export
   */
  private generateFilename(options: ExportOptions): string {
    const date = new Date().toISOString().split('T')[0];
    const ticker = options.ticker.toUpperCase();

    switch (options.exportMode) {
      case ExportMode.QUARTERLY:
        return `${ticker}_10Q_${options.years[0]}_Statements_${date}.xlsx`;
      case ExportMode.COMBINED:
        return `${ticker}_Combined_Statements_${date}.xlsx`;
      case ExportMode.ANNUAL:
      default:
        return `${ticker}_10K_Statements_${date}.xlsx`;
    }
  }

  /**
   * Export comp table to Excel
   */
  async exportCompTable(
    compTableData: any,
    options: { ticker: string; period: string; companies: string[] },
  ): Promise<ExportResult> {
    this.logger.log(`Exporting comp table for ${options.companies.length} companies`);

    const buffer = await this.xlsxGenerator.generateCompTableWorkbook(
      compTableData,
      {
        ticker: options.ticker,
        period: options.period,
        companies: options.companies,
      },
    );

    const date = new Date().toISOString().split('T')[0];
    const filename = `CompTable_${options.ticker}_${options.period}_${date}.xlsx`;

    return { buffer, filename };
  }

  /**
   * Export change tracker to Excel
   */
  async exportChangeTracker(
    changeTrackerData: any,
    options: { ticker: string; fromPeriod: string; toPeriod: string },
  ): Promise<ExportResult> {
    this.logger.log(
      `Exporting change tracker for ${options.ticker} from ${options.fromPeriod} to ${options.toPeriod}`,
    );

    const buffer = await this.xlsxGenerator.generateChangeTrackerWorkbook(
      changeTrackerData,
      {
        ticker: options.ticker,
        fromPeriod: options.fromPeriod,
        toPeriod: options.toPeriod,
      },
    );

    const date = new Date().toISOString().split('T')[0];
    const filename = `ChangeTracker_${options.ticker}_${options.fromPeriod}_to_${options.toPeriod}_${date}.xlsx`;

    return { buffer, filename };
  }
}
