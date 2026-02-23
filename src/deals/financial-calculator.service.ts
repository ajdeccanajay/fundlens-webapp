import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Python parser URL - in ECS this is the sidecar container, locally it's localhost
const PYTHON_PARSER_URL = process.env.PYTHON_PARSER_URL || 'http://localhost:8000';

// HTTP timeout for Python calculator calls (2 minutes for large calculations)
const PYTHON_HTTP_TIMEOUT_MS = 120000;

// Retry configuration for enterprise resilience
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

export interface CalculatedMetric {
  id: number;
  ticker: string;
  metricName: string;
  value: number;
  period: string;
  periodType: string;
  calculationMethod: string;
  sourceMetrics: string[];
  confidenceScore: number;
  calculationDate: Date;
  validationStatus: string;
}

export interface MetricsSummary {
  ticker: string;
  companyName?: string;
  isPublic: boolean;
  calculationDate: Date;
  reportType?: string;
  periods?: number;
  years?: number;
  metrics: {
    revenue?: {
      ttm?: number;
      annual?: { period: string; value: number }[];
      cagr?: number;
      yoyGrowth?: { period: string; value: number }[];
    };
    profitability?: {
      grossProfit?: { ttm?: number; annual?: { period: string; value: number }[] };
      grossMargin?: { ttm?: number; annual?: { period: string; value: number }[] };
      operatingIncome?: { ttm?: number; annual?: { period: string; value: number }[] };
      operatingMargin?: { ttm?: number; annual?: { period: string; value: number }[] };
      ebitda?: { ttm?: number; annual?: { period: string; value: number }[] };
      ebitdaMargin?: { ttm?: number; annual?: { period: string; value: number }[] };
      netIncome?: { ttm?: number; annual?: { period: string; value: number }[]; yoyGrowth?: { period: string; value: number }[] };
      netMargin?: { ttm?: number; annual?: { period: string; value: number }[] };
    };
    cashFlow?: {
      operatingCashFlow?: { ttm?: number; annual?: { period: string; value: number }[] };
      freeCashFlow?: { ttm?: number; annual?: { period: string; value: number }[] };
      capex?: { ttm?: number; annual?: { period: string; value: number }[] };
      capexPctRevenue?: { ttm?: number };
      cashConversionRatio?: { ttm?: number; annual?: { period: string; value: number }[] };
    };
    workingCapital?: {
      dso?: { period: string; value: number }[];
      dio?: { period: string; value: number }[];
      dpo?: { period: string; value: number }[];
      cashConversionCycle?: { period: string; value: number }[];
    };
    balanceSheet?: {
      currentRatio?: { period: string; value: number }[];
      quickRatio?: { period: string; value: number }[];
      workingCapital?: { period: string; value: number }[];
      debtToEquity?: { period: string; value: number }[];
      roe?: { period: string; value: number }[];
      assetTurnover?: { period: string; value: number }[];
    };
    valuation?: {
      marketCap?: number;
      sharePrice?: number;
      sharesOutstanding?: number;
    };
  };
}

/**
 * Financial Calculator Service
 * Integrates with COMPREHENSIVE Python calculation engine for deterministic financial metrics
 * 
 * ENTERPRISE-GRADE ARCHITECTURE:
 * - PRIMARY: HTTP calls to Python calculator container (works in ECS)
 * - FALLBACK: Build summary from raw metrics in PostgreSQL
 * - Retry logic with exponential backoff
 * - Health checks before calculation
 */
@Injectable()
export class FinancialCalculatorService {
  private readonly logger = new Logger(FinancialCalculatorService.name);
  private pythonHealthy = true;
  private lastHealthCheck = 0;
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000; // 30 seconds

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if Python calculator is healthy
   */
  private async checkPythonHealth(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastHealthCheck < this.HEALTH_CHECK_INTERVAL_MS) {
      return this.pythonHealthy;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(`${PYTHON_PARSER_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      
      this.pythonHealthy = response.ok;
      this.lastHealthCheck = now;
      
      if (this.pythonHealthy) {
        this.logger.log('✅ Python calculator health check: OK');
      } else {
        this.logger.warn(`⚠️ Python calculator health check: HTTP ${response.status}`);
      }
      
      return this.pythonHealthy;
    } catch (error) {
      this.pythonHealthy = false;
      this.lastHealthCheck = now;
      this.logger.warn(`⚠️ Python calculator health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate all metrics for a company using COMPREHENSIVE Python engine via HTTP
   * 
   * ENTERPRISE-GRADE IMPLEMENTATION:
   * - PRIMARY: HTTP call to Python calculator container
   * - Retry logic with exponential backoff
   * - FALLBACK: Returns empty array (raw metrics still available in DB)
   */
  async calculateMetrics(ticker: string, sharePrice?: number, years: number = 5): Promise<CalculatedMetric[]> {
    this.logger.log(`🧮 Calculating COMPREHENSIVE metrics for ${ticker} via Python HTTP API (${years} years)`);

    // Check Python health first
    const isHealthy = await this.checkPythonHealth();
    if (!isHealthy) {
      this.logger.warn(`Python calculator not healthy - will attempt anyway with retries`);
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PYTHON_HTTP_TIMEOUT_MS);

        const response = await fetch(`${PYTHON_PARSER_URL}/calculate-metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: ticker.toUpperCase(),
            years,
            sharePrice: sharePrice || null,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Python calculator returned HTTP ${response.status}`);
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.error || 'Python calculator returned success=false');
        }

        this.logger.log(`✅ Python calculator returned ${result.metricsCount} metrics for ${ticker} (saved: ${result.savedToDatabase})`);

        // Retrieve calculated metrics from database (Python saved them)
        const metrics = await this.getCalculatedMetrics(ticker);
        return metrics;

      } catch (error) {
        lastError = error;
        
        const isRetryable = 
          error.name === 'AbortError' ||
          error.message?.includes('fetch failed') ||
          error.message?.includes('ECONNREFUSED') ||
          error.message?.includes('ECONNRESET');

        if (isRetryable && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          this.logger.warn(`Python calculator attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}. Retrying in ${delay}ms...`);
          await this.sleep(delay);
        } else if (!isRetryable) {
          // Non-retryable error - break immediately
          this.logger.error(`Python calculator non-retryable error: ${error.message}`);
          break;
        }
      }
    }

    // All retries failed - check if we have existing calculated metrics
    this.logger.warn(`Python calculator failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
    
    const existingCount = await this.prisma.calculatedMetric.count({ 
      where: { ticker: ticker.toUpperCase() } 
    });
    
    if (existingCount > 0) {
      this.logger.log(`✅ Found ${existingCount} existing calculated metrics for ${ticker} - using cached data`);
      return await this.getCalculatedMetrics(ticker);
    }

    // No calculated metrics - return empty (raw metrics are still available)
    this.logger.warn(`No calculated metrics available for ${ticker}. Raw metrics can still be used.`);
    return [];
  }

  /**
   * Get calculated metrics from database
   */
  async getCalculatedMetrics(
    ticker: string,
    metricNames?: string[],
  ): Promise<CalculatedMetric[]> {
    try {
      let query = `
        SELECT 
          id, ticker, metric_name as "metricName", value, period, period_type as "periodType",
          calculation_method as "calculationMethod", source_metrics as "sourceMetrics",
          confidence_score as "confidenceScore", calculation_date as "calculationDate",
          validation_status as "validationStatus"
        FROM calculated_metrics
        WHERE ticker = $1
      `;
      
      const params: any[] = [ticker.toUpperCase()];
      
      if (metricNames && metricNames.length > 0) {
        query += ` AND metric_name = ANY($2::text[])`;
        params.push(metricNames);
      }
      
      query += ` ORDER BY calculation_date DESC`;
      
      const metrics = await this.prisma.$queryRawUnsafe<any[]>(query, ...params);

      return metrics.map((m) => ({
        ...m,
        value: parseFloat(m.value),
        confidenceScore: parseFloat(m.confidenceScore),
      }));
    } catch (error) {
      this.logger.error(`Failed to get calculated metrics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get COMPREHENSIVE metrics summary organized by category
   * 
   * PRODUCTION FIX: Falls back to raw metrics when calculated metrics don't exist
   * This ensures the dashboard works even when Python calculator isn't available
   */
  async getMetricsSummary(
    ticker: string,
    years: number = 5,
  ): Promise<MetricsSummary> {
    this.logger.log(`Getting COMPREHENSIVE metrics summary for ${ticker} (${years} years of data)`);

    try {
      const metrics = await this.getCalculatedMetrics(ticker);

      this.logger.log(`Retrieved ${metrics.length} calculated metrics for ${ticker}`);

      // PRODUCTION FIX: If no calculated metrics, build summary from raw metrics
      if (metrics.length === 0) {
        this.logger.log(`No calculated metrics for ${ticker}, building summary from raw metrics...`);
        return await this.buildSummaryFromRawMetrics(ticker, years);
      }

      // Initialize comprehensive summary structure
      const summary: MetricsSummary = {
        ticker: ticker.toUpperCase(),
        isPublic: true,
        calculationDate: metrics[0].calculationDate,
        years,
        metrics: {
          revenue: { ttm: undefined, annual: [], cagr: undefined, yoyGrowth: [] },
          profitability: {
            grossProfit: { ttm: undefined, annual: [] },
            grossMargin: { ttm: undefined, annual: [] },
            operatingIncome: { ttm: undefined, annual: [] },
            operatingMargin: { ttm: undefined, annual: [] },
            ebitda: { ttm: undefined, annual: [] },
            ebitdaMargin: { ttm: undefined, annual: [] },
            netIncome: { ttm: undefined, annual: [], yoyGrowth: [] },
            netMargin: { ttm: undefined, annual: [] },
          },
          cashFlow: {
            operatingCashFlow: { ttm: undefined, annual: [] },
            freeCashFlow: { ttm: undefined, annual: [] },
            capex: { ttm: undefined, annual: [] },
            capexPctRevenue: { ttm: undefined },
            cashConversionRatio: { ttm: undefined, annual: [] },
          },
          workingCapital: { dso: [], dio: [], dpo: [], cashConversionCycle: [] },
          balanceSheet: {
            currentRatio: [], quickRatio: [], workingCapital: [],
            debtToEquity: [], roe: [], assetTurnover: [],
          },
          valuation: {},
        },
      };

      // Process each metric
      for (const metric of metrics) {
        const value = parseFloat(metric.value.toString());
        const period = metric.period;
        const name = metric.metricName;

        // Revenue metrics
        if (name === 'revenue_ttm') summary.metrics.revenue!.ttm = value;
        if (name === 'revenue_cagr') summary.metrics.revenue!.cagr = value;
        if (name === 'revenue_annual') summary.metrics.revenue!.annual!.push({ period, value });
        if (name === 'revenue_yoy_growth') summary.metrics.revenue!.yoyGrowth!.push({ period, value });

        // Gross Profit & Margin
        if (name === 'gross_profit_ttm') summary.metrics.profitability!.grossProfit!.ttm = value;
        if (name === 'gross_profit_annual') summary.metrics.profitability!.grossProfit!.annual!.push({ period, value });
        if (name === 'gross_margin_ttm') summary.metrics.profitability!.grossMargin!.ttm = value;
        if (name === 'gross_margin_annual') summary.metrics.profitability!.grossMargin!.annual!.push({ period, value });

        // Operating Income & Margin
        if (name === 'operating_income_ttm') summary.metrics.profitability!.operatingIncome!.ttm = value;
        if (name === 'operating_income_annual') summary.metrics.profitability!.operatingIncome!.annual!.push({ period, value });
        if (name === 'operating_margin_ttm') summary.metrics.profitability!.operatingMargin!.ttm = value;
        if (name === 'operating_margin_annual') summary.metrics.profitability!.operatingMargin!.annual!.push({ period, value });

        // EBITDA & Margin
        if (name === 'ebitda_ttm') summary.metrics.profitability!.ebitda!.ttm = value;
        if (name === 'ebitda_annual') summary.metrics.profitability!.ebitda!.annual!.push({ period, value });
        if (name === 'ebitda_margin_ttm') summary.metrics.profitability!.ebitdaMargin!.ttm = value;
        if (name === 'ebitda_margin_annual') summary.metrics.profitability!.ebitdaMargin!.annual!.push({ period, value });

        // Net Income & Margin
        if (name === 'net_income_ttm') summary.metrics.profitability!.netIncome!.ttm = value;
        if (name === 'net_income_annual') summary.metrics.profitability!.netIncome!.annual!.push({ period, value });
        if (name === 'net_income_yoy_growth') summary.metrics.profitability!.netIncome!.yoyGrowth!.push({ period, value });
        if (name === 'net_margin_ttm') summary.metrics.profitability!.netMargin!.ttm = value;
        if (name === 'net_margin_annual') summary.metrics.profitability!.netMargin!.annual!.push({ period, value });

        // Cash Flow metrics
        if (name === 'operating_cash_flow_ttm') summary.metrics.cashFlow!.operatingCashFlow!.ttm = value;
        if (name === 'operating_cash_flow_annual') summary.metrics.cashFlow!.operatingCashFlow!.annual!.push({ period, value });
        if (name === 'free_cash_flow_ttm') summary.metrics.cashFlow!.freeCashFlow!.ttm = value;
        if (name === 'free_cash_flow_annual') summary.metrics.cashFlow!.freeCashFlow!.annual!.push({ period, value });
        if (name === 'capex_ttm') summary.metrics.cashFlow!.capex!.ttm = value;
        if (name === 'capex_pct_revenue_ttm') summary.metrics.cashFlow!.capexPctRevenue!.ttm = value;
        if (name === 'cash_conversion_ratio_ttm') summary.metrics.cashFlow!.cashConversionRatio!.ttm = value;
        if (name === 'cash_conversion_ratio_annual') summary.metrics.cashFlow!.cashConversionRatio!.annual!.push({ period, value });

        // Working Capital Cycle
        if (name === 'dso_annual') summary.metrics.workingCapital!.dso!.push({ period, value });
        if (name === 'dio_annual') summary.metrics.workingCapital!.dio!.push({ period, value });
        if (name === 'dpo_annual') summary.metrics.workingCapital!.dpo!.push({ period, value });
        if (name === 'cash_conversion_cycle_annual') summary.metrics.workingCapital!.cashConversionCycle!.push({ period, value });

        // Balance Sheet Health
        if (name === 'current_ratio_annual') summary.metrics.balanceSheet!.currentRatio!.push({ period, value });
        if (name === 'quick_ratio_annual') summary.metrics.balanceSheet!.quickRatio!.push({ period, value });
        if (name === 'working_capital_annual') summary.metrics.balanceSheet!.workingCapital!.push({ period, value });
        if (name === 'debt_to_equity_annual') summary.metrics.balanceSheet!.debtToEquity!.push({ period, value });
        if (name === 'roe_annual') summary.metrics.balanceSheet!.roe!.push({ period, value });
        if (name === 'asset_turnover_annual') summary.metrics.balanceSheet!.assetTurnover!.push({ period, value });

        // Valuation
        if (name === 'market_cap') summary.metrics.valuation!.marketCap = value;
        if (name === 'share_price') summary.metrics.valuation!.sharePrice = value;
        if (name === 'shares_outstanding') summary.metrics.valuation!.sharesOutstanding = value;
      }

      // Sort annual arrays by period (most recent first)
      const sortByPeriod = (a: any, b: any) => b.period.localeCompare(a.period);
      summary.metrics.revenue!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.grossProfit!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.grossMargin!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.operatingIncome!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.operatingMargin!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.ebitda!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.ebitdaMargin!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.netIncome!.annual!.sort(sortByPeriod);
      summary.metrics.profitability!.netMargin!.annual!.sort(sortByPeriod);
      summary.metrics.cashFlow!.operatingCashFlow!.annual!.sort(sortByPeriod);
      summary.metrics.cashFlow!.freeCashFlow!.annual!.sort(sortByPeriod);
      summary.metrics.workingCapital!.dso!.sort(sortByPeriod);
      summary.metrics.workingCapital!.dio!.sort(sortByPeriod);
      summary.metrics.workingCapital!.dpo!.sort(sortByPeriod);
      summary.metrics.workingCapital!.cashConversionCycle!.sort(sortByPeriod);
      summary.metrics.balanceSheet!.currentRatio!.sort(sortByPeriod);
      summary.metrics.balanceSheet!.quickRatio!.sort(sortByPeriod);
      summary.metrics.balanceSheet!.workingCapital!.sort(sortByPeriod);
      summary.metrics.balanceSheet!.debtToEquity!.sort(sortByPeriod);
      summary.metrics.balanceSheet!.roe!.sort(sortByPeriod);
      summary.metrics.balanceSheet!.assetTurnover!.sort(sortByPeriod);

      this.logger.log(`COMPREHENSIVE metrics summary prepared for ${ticker} (${years} years of data)`);
      return summary;
    } catch (error) {
      this.logger.error(`Failed to get metrics summary: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build metrics summary from raw SEC filing metrics when calculated metrics aren't available
   * 
   * FALLBACK METHOD: Used when Python calculator is unavailable
   * Provides basic metrics directly from SEC filings stored in financial_metrics table
   */
  private async buildSummaryFromRawMetrics(ticker: string, years: number): Promise<MetricsSummary> {
    this.logger.log(`Building summary from raw metrics for ${ticker} (${years} years)`);

    const upperTicker = ticker.toUpperCase();

    // Initialize summary structure
    const summary: MetricsSummary = {
      ticker: upperTicker,
      isPublic: true,
      calculationDate: new Date(),
      years,
      metrics: {
        revenue: { ttm: undefined, annual: [], cagr: undefined, yoyGrowth: [] },
        profitability: {
          grossProfit: { ttm: undefined, annual: [] },
          grossMargin: { ttm: undefined, annual: [] },
          operatingIncome: { ttm: undefined, annual: [] },
          operatingMargin: { ttm: undefined, annual: [] },
          ebitda: { ttm: undefined, annual: [] },
          ebitdaMargin: { ttm: undefined, annual: [] },
          netIncome: { ttm: undefined, annual: [], yoyGrowth: [] },
          netMargin: { ttm: undefined, annual: [] },
        },
        cashFlow: {
          operatingCashFlow: { ttm: undefined, annual: [] },
          freeCashFlow: { ttm: undefined, annual: [] },
          capex: { ttm: undefined, annual: [] },
          capexPctRevenue: { ttm: undefined },
          cashConversionRatio: { ttm: undefined, annual: [] },
        },
        workingCapital: { dso: [], dio: [], dpo: [], cashConversionCycle: [] },
        balanceSheet: {
          currentRatio: [], quickRatio: [], workingCapital: [],
          debtToEquity: [], roe: [], assetTurnover: [],
        },
        valuation: {},
      },
    };

    try {
      // Get raw metrics from database - annual 10-K filings only for cleaner data
      const rawMetrics = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT normalized_metric, value, fiscal_period, period_type, filing_type
        FROM financial_metrics
        WHERE ticker = $1 
          AND filing_type = '10-K'
          AND period_type = 'annual'
        ORDER BY fiscal_period DESC
        LIMIT 500
      `, upperTicker);

      if (rawMetrics.length === 0) {
        this.logger.warn(`No raw metrics found for ${upperTicker}`);
        return summary;
      }

      this.logger.log(`Found ${rawMetrics.length} raw metrics for ${upperTicker}`);

      // Group metrics by normalized name
      const metricsByName: Record<string, { period: string; value: number }[]> = {};
      
      for (const m of rawMetrics) {
        const name = m.normalized_metric?.toLowerCase() || '';
        const value = parseFloat(m.value);
        const period = m.fiscal_period;
        
        if (!metricsByName[name]) {
          metricsByName[name] = [];
        }
        
        // Avoid duplicates for same period
        if (!metricsByName[name].find(x => x.period === period)) {
          metricsByName[name].push({ period, value });
        }
      }

      // Helper to get latest value for a metric
      const getLatest = (names: string[]): number | undefined => {
        for (const name of names) {
          const values = metricsByName[name];
          if (values && values.length > 0) {
            // Sort by period descending and get first
            values.sort((a, b) => b.period.localeCompare(a.period));
            return values[0].value;
          }
        }
        return undefined;
      };

      // Helper to get annual values for a metric
      const getAnnual = (names: string[], limit: number = years): { period: string; value: number }[] => {
        for (const name of names) {
          const values = metricsByName[name];
          if (values && values.length > 0) {
            values.sort((a, b) => b.period.localeCompare(a.period));
            return values.slice(0, limit);
          }
        }
        return [];
      };

      // Populate revenue
      const revenueNames = ['revenue', 'revenues', 'total_revenue', 'net_revenue'];
      summary.metrics.revenue!.ttm = getLatest(revenueNames);
      summary.metrics.revenue!.annual = getAnnual(revenueNames);

      // Populate gross profit
      const grossProfitNames = ['gross_profit', 'grossprofit'];
      summary.metrics.profitability!.grossProfit!.ttm = getLatest(grossProfitNames);
      summary.metrics.profitability!.grossProfit!.annual = getAnnual(grossProfitNames);

      // Calculate gross margin if we have revenue and gross profit
      const revenue = summary.metrics.revenue!.ttm;
      const grossProfit = summary.metrics.profitability!.grossProfit!.ttm;
      if (revenue && grossProfit && revenue > 0) {
        summary.metrics.profitability!.grossMargin!.ttm = grossProfit / revenue;
      }

      // Populate operating income
      const opIncomeNames = ['operating_income', 'operatingincomeloss', 'operating_income_loss'];
      summary.metrics.profitability!.operatingIncome!.ttm = getLatest(opIncomeNames);
      summary.metrics.profitability!.operatingIncome!.annual = getAnnual(opIncomeNames);

      // Calculate operating margin
      const opIncome = summary.metrics.profitability!.operatingIncome!.ttm;
      if (revenue && opIncome && revenue > 0) {
        summary.metrics.profitability!.operatingMargin!.ttm = opIncome / revenue;
      }

      // Populate net income
      const netIncomeNames = ['net_income', 'netincomeloss', 'net_income_loss'];
      summary.metrics.profitability!.netIncome!.ttm = getLatest(netIncomeNames);
      summary.metrics.profitability!.netIncome!.annual = getAnnual(netIncomeNames);

      // Calculate net margin
      const netIncome = summary.metrics.profitability!.netIncome!.ttm;
      if (revenue && netIncome && revenue > 0) {
        summary.metrics.profitability!.netMargin!.ttm = netIncome / revenue;
      }

      // Populate operating cash flow
      const ocfNames = ['operating_cash_flow', 'net_cash_provided_by_operating', 'netcashprovidedbyusedoperating'];
      summary.metrics.cashFlow!.operatingCashFlow!.ttm = getLatest(ocfNames);
      summary.metrics.cashFlow!.operatingCashFlow!.annual = getAnnual(ocfNames);

      // Populate total assets for balance sheet
      const assetsNames = ['total_assets', 'assets'];
      const totalAssets = getLatest(assetsNames);

      // Populate total liabilities
      const liabilitiesNames = ['total_liabilities', 'liabilities'];
      const totalLiabilities = getLatest(liabilitiesNames);

      // Populate stockholders equity
      const equityNames = ['stockholders_equity', 'totalequity', 'total_equity'];
      const equity = getLatest(equityNames);

      // Calculate debt to equity if we have the data
      if (totalLiabilities && equity && equity !== 0) {
        summary.metrics.balanceSheet!.debtToEquity = [{ 
          period: 'Latest', 
          value: totalLiabilities / equity 
        }];
      }

      // Calculate ROE if we have net income and equity
      if (netIncome && equity && equity !== 0) {
        summary.metrics.balanceSheet!.roe = [{ 
          period: 'Latest', 
          value: netIncome / equity 
        }];
      }

      // Current assets and liabilities for ratios
      const currentAssetsNames = ['current_assets', 'assetscurrent'];
      const currentLiabilitiesNames = ['current_liabilities', 'liabilitiescurrent'];
      const currentAssets = getLatest(currentAssetsNames);
      const currentLiabilities = getLatest(currentLiabilitiesNames);

      // Calculate current ratio
      if (currentAssets && currentLiabilities && currentLiabilities !== 0) {
        summary.metrics.balanceSheet!.currentRatio = [{ 
          period: 'Latest', 
          value: currentAssets / currentLiabilities 
        }];
      }

      this.logger.log(`Built summary from raw metrics for ${upperTicker}: revenue=${summary.metrics.revenue?.ttm}, netIncome=${summary.metrics.profitability?.netIncome?.ttm}`);
      
      return summary;

    } catch (error) {
      this.logger.error(`Failed to build summary from raw metrics: ${error.message}`);
      // Return empty summary rather than throwing
      return summary;
    }
  }

  /**
   * Calculate and cache metrics for a company
   */
  async calculateAndCache(
    ticker: string,
    sharePrice?: number,
    years: number = 3,
  ): Promise<MetricsSummary> {
    this.logger.log(`Calculating and caching metrics for ${ticker} (${years} years comprehensive data)`);

    try {
      // Calculate metrics using Python engine with years parameter
      await this.calculateMetrics(ticker, sharePrice);

      // Return organized summary with context
      return await this.getMetricsSummary(ticker, years);
    } catch (error) {
      this.logger.error(`Failed to calculate and cache metrics: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get metrics for multiple companies (for comparison)
   */
  async getMultipleCompanyMetrics(tickers: string[]): Promise<Record<string, MetricsSummary>> {
    this.logger.log(`Getting metrics for ${tickers.length} companies`);

    const results: Record<string, MetricsSummary> = {};

    for (const ticker of tickers) {
      try {
        results[ticker] = await this.getMetricsSummary(ticker);
      } catch (error) {
        this.logger.warn(`Failed to get metrics for ${ticker}: ${error.message}`);
        results[ticker] = null as any;
      }
    }

    return results;
  }

  /**
   * Format metric value for display
   */
  formatMetricValue(value: number, metricType: string): string {
    if (value === null || value === undefined) {
      return 'N/A';
    }

    // Percentages
    if (
      metricType.includes('margin') ||
      metricType.includes('yield') ||
      metricType.includes('cagr')
    ) {
      return `${(value * 100).toFixed(2)}%`;
    }

    // Currency values
    if (value >= 1e12) {
      return `$${(value / 1e12).toFixed(2)}T`;
    } else if (value >= 1e9) {
      return `$${(value / 1e9).toFixed(2)}B`;
    } else if (value >= 1e6) {
      return `$${(value / 1e6).toFixed(2)}M`;
    } else if (value >= 1e3) {
      return `$${(value / 1e3).toFixed(2)}K`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  }

  /**
   * Validate calculated metrics against source data
   */
  async validateMetrics(ticker: string): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    this.logger.log(`Validating metrics for ${ticker}`);

    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const metrics = await this.getCalculatedMetrics(ticker);

      // Check for required metrics
      const requiredMetrics = [
        'revenue_ttm',
        'gross_profit_ttm',
        'gross_margin_ttm',
        'operating_income_ttm',
      ];

      for (const required of requiredMetrics) {
        const found = metrics.find((m) => m.metricName === required);
        if (!found) {
          warnings.push(`Missing required metric: ${required}`);
        }
      }

      // Check confidence scores
      const lowConfidence = metrics.filter((m) => m.confidenceScore < 0.7);
      if (lowConfidence.length > 0) {
        warnings.push(
          `${lowConfidence.length} metrics have low confidence scores (< 0.7)`,
        );
      }

      // Check for negative values where they shouldn't be
      const shouldBePositive = ['revenue_ttm', 'gross_profit_ttm'];
      for (const metricName of shouldBePositive) {
        const metric = metrics.find((m) => m.metricName === metricName);
        if (metric && metric.value < 0) {
          errors.push(`${metricName} has negative value: ${metric.value}`);
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    } catch (error) {
      this.logger.error(`Failed to validate metrics: ${error.message}`);
      return {
        valid: false,
        errors: [error.message],
        warnings: [],
      };
    }
  }

  /**
   * Get count of narrative chunks for a ticker
   * Used to check if qualitative precomputation is possible
   */
  async getNarrativeCount(ticker: string): Promise<number> {
    return this.prisma.narrativeChunk.count({
      where: { ticker: ticker.toUpperCase() },
    });
  }

  /**
   * Evaluates a formula expression with named inputs via the Python /calculate endpoint.
   * Uses simpleeval on the Python side for safe, sandboxed evaluation.
   *
   * @param formula - Formula string, e.g. "gross_profit / revenue * 100"
   * @param inputs - Named numeric inputs, e.g. { gross_profit: 50000000, revenue: 120000000 }
   * @param outputFormat - Output format hint (percentage, ratio, currency, days)
   * @returns Object with result and audit trail, or null with error explanation
   */
  async evaluateFormula(
    formula: string,
    inputs: Record<string, number>,
    outputFormat: string = 'ratio',
  ): Promise<{ result: number; audit_trail: any } | { result: null; error: string }> {
    this.logger.debug(
      `Evaluating formula: ${formula} with ${Object.keys(inputs).length} inputs`,
    );

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${PYTHON_PARSER_URL}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formula, inputs }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json();

      if (data.error) {
        this.logger.warn(`Formula evaluation error: ${data.error}`);
        return { result: null, error: data.error };
      }

      return {
        result: data.result,
        audit_trail: data.audit_trail,
      };
    } catch (error) {
      this.logger.error(`Failed to evaluate formula via Python: ${error.message}`);
      return { result: null, error: `Python calculator unreachable: ${error.message}` };
    }
  }

}
