import { Controller, Get, Post, Param, Query, Logger, Body } from '@nestjs/common';
import { FinancialCalculatorService, MetricsSummary } from './financial-calculator.service';
import { SemanticRetrieverService } from '../rag/semantic-retriever.service';
import { BedrockService } from '../rag/bedrock.service';
import { QualitativePrecomputeService } from './qualitative-precompute.service';

// Predefined qualitative questions for company analysis
const QUALITATIVE_QUESTIONS = {
  managementCredibility: [
    "Compare {ticker} management's forward-looking guidance from the past 4 quarters against actual reported results. Where have they consistently over-promised or under-delivered?",
    "What are the largest insider transactions (buys, sells, grants) for {ticker} in the last 12 months, and how do they correlate with the timing of material disclosures in 8-Ks?",
  ],
  balanceSheetProtection: [
    "Identify all off-balance sheet obligations, contingent liabilities, and guarantees disclosed across {ticker}'s most recent 10-K and 10-Q footnotes. Quantify total exposure relative to equity.",
    "What is {ticker}'s maturity schedule of all outstanding debt, and what covenants or cross-default provisions could be triggered under a 20% revenue decline scenario?",
  ],
  capitalAllocation: [
    "Over the past 3 years, how has {ticker} management allocated free cash flow between buybacks, dividends, M&A, capex, and debt paydown? Calculate the implied return on each allocation.",
    "Identify all acquisitions {ticker} has made in the past 5 years. For each, compare the stated strategic rationale at announcement to the actual financial performance disclosed in subsequent filings.",
  ],
  earningsQuality: [
    "Flag any changes in {ticker}'s accounting policies, critical estimates, or revenue recognition methods disclosed in the past 3 years. What was the stated justification and quantified impact for each?",
    "Calculate the divergence between {ticker}'s reported net income and operating cash flow over the past 8 quarters. Identify the primary drivers of any widening gap.",
  ],
  competitiveRisk: [
    "Compare {ticker}'s Risk Factors section across the last 3 annual filings. What risks were added, removed, or materially re-worded, and what business developments explain the changes?",
    "From {ticker}'s most recent earnings call, identify every question where management gave a non-answer, deflected, or pivoted away from the analyst's actual question. What topics were they avoiding?",
  ],
};

/**
 * Financial Calculator Controller
 * Provides endpoints for calculating and retrieving financial metrics
 */
@Controller('financial-calculator')
export class FinancialCalculatorController {
  private readonly logger = new Logger(FinancialCalculatorController.name);

  constructor(
    private readonly financialCalculatorService: FinancialCalculatorService,
    private readonly semanticRetriever: SemanticRetrieverService,
    private readonly bedrockService: BedrockService,
    private readonly qualitativePrecompute: QualitativePrecomputeService,
  ) {}

  /**
   * Calculate all metrics for a company
   * POST /api/financial-calculator/calculate/:ticker
   */
  @Post('calculate/:ticker')
  async calculateMetrics(
    @Param('ticker') ticker: string,
    @Body() body: { sharePrice?: number; years?: number } = {},
  ) {
    const years = body.years || 3;
    this.logger.log(`Calculating metrics for ${ticker} (${years} years of comprehensive data)`);

    try {
      const summary = await this.financialCalculatorService.calculateAndCache(
        ticker,
        body.sharePrice,
        years,
      );

      return {
        success: true,
        data: summary,
        message: `Metrics calculated for ${ticker} using ${years} years of comprehensive SEC data`,
      };
    } catch (error) {
      this.logger.error(`Failed to calculate metrics for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to calculate metrics for ${ticker}`,
      };
    }
  }

  /**
   * Get calculated metrics summary
   * GET /api/financial-calculator/summary/:ticker
   */
  @Get('summary/:ticker')
  async getMetricsSummary(@Param('ticker') ticker: string) {
    this.logger.log(`Getting metrics summary for ${ticker}`);

    try {
      const summary = await this.financialCalculatorService.getMetricsSummary(ticker);

      return {
        success: true,
        data: summary,
        message: `Metrics summary retrieved for ${ticker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to get metrics summary for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to get metrics summary for ${ticker}`,
      };
    }
  }

  /**
   * Get specific calculated metrics
   * GET /api/financial-calculator/metrics/:ticker?names=revenue_ttm,gross_margin_ttm
   */
  @Get('metrics/:ticker')
  async getCalculatedMetrics(
    @Param('ticker') ticker: string,
    @Query('names') names?: string,
  ) {
    this.logger.log(`Getting calculated metrics for ${ticker}`);

    try {
      const metricNames = names ? names.split(',').map((n) => n.trim()) : undefined;
      const metrics = await this.financialCalculatorService.getCalculatedMetrics(
        ticker,
        metricNames,
      );

      return {
        success: true,
        data: metrics,
        count: metrics.length,
        message: `Retrieved ${metrics.length} metrics for ${ticker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to get metrics for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to get metrics for ${ticker}`,
      };
    }
  }

  /**
   * Compare metrics across multiple companies
   * POST /api/financial-calculator/compare
   */
  @Post('compare')
  async compareCompanies(@Body() body: { tickers: string[] }) {
    const { tickers } = body;

    if (!tickers || tickers.length === 0) {
      return {
        success: false,
        message: 'Tickers array is required',
      };
    }

    this.logger.log(`Comparing metrics for ${tickers.length} companies`);

    try {
      const comparison = await this.financialCalculatorService.getMultipleCompanyMetrics(
        tickers,
      );

      // Create comparison table
      const comparisonTable = this.createComparisonTable(comparison);

      return {
        success: true,
        data: {
          companies: comparison,
          comparison: comparisonTable,
        },
        message: `Comparison completed for ${tickers.length} companies`,
      };
    } catch (error) {
      this.logger.error(`Failed to compare companies: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to compare companies',
      };
    }
  }

  /**
   * Validate calculated metrics
   * GET /api/financial-calculator/validate/:ticker
   */
  @Get('validate/:ticker')
  async validateMetrics(@Param('ticker') ticker: string) {
    this.logger.log(`Validating metrics for ${ticker}`);

    try {
      const validation = await this.financialCalculatorService.validateMetrics(ticker);

      return {
        success: true,
        data: validation,
        message: `Validation completed for ${ticker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to validate metrics for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to validate metrics for ${ticker}`,
      };
    }
  }

  /**
   * Get formatted metrics for dashboard display
   * GET /api/financial-calculator/dashboard/:ticker?years=5
   */
  @Get('dashboard/:ticker')
  async getDashboardMetrics(
    @Param('ticker') ticker: string,
    @Query('years') years?: string,
  ) {
    const yearsNum = years ? parseInt(years) : 5;
    
    this.logger.log(`Getting COMPREHENSIVE dashboard metrics for ${ticker} (${yearsNum} years)`);

    try {
      const summary = await this.financialCalculatorService.getMetricsSummary(
        ticker,
        yearsNum,
      );

      // Return ALL comprehensive metrics for dashboard display
      const dashboardData = {
        ticker: summary.ticker,
        calculationDate: summary.calculationDate,
        years: yearsNum,
        dataDescription: this.getDataDescription(yearsNum),
        // Pass through the complete metrics structure
        metrics: summary.metrics,
        // Also provide top-level access for backward compatibility
        revenue: summary.metrics.revenue,
        profitability: summary.metrics.profitability,
        cashFlow: summary.metrics.cashFlow,
        workingCapital: summary.metrics.workingCapital,
        balanceSheet: summary.metrics.balanceSheet,
        valuation: summary.metrics.valuation,
      };

      return {
        success: true,
        data: dashboardData,
        message: `Comprehensive dashboard metrics retrieved for ${ticker} (${yearsNum} years)`,
      };
    } catch (error) {
      this.logger.error(`Failed to get dashboard metrics for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to get dashboard metrics for ${ticker}`,
      };
    }
  }

  /**
   * Get data description for display
   */
  private getDataDescription(years: number): string {
    const numQuarters = years * 4; // 4 quarters per year
    return `${years} annual 10-K filings, ${numQuarters} quarterly 10-Q filings, and all 8-K current reports for comprehensive analysis with accurate TTM calculations`;
  }

  /**
   * Create comparison table for multiple companies
   */
  private createComparisonTable(comparison: Record<string, MetricsSummary>): any {
    const tickers = Object.keys(comparison);
    const table: any = {
      headers: ['Metric', ...tickers],
      rows: [],
    };

    // Revenue metrics
    table.rows.push([
      'Revenue (TTM)',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.revenue?.ttm, 'currency'),
      ),
    ]);

    table.rows.push([
      'Revenue CAGR',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.revenue?.cagr, 'percentage'),
      ),
    ]);

    // Profitability metrics
    table.rows.push([
      'Gross Profit (TTM)',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.profitability?.grossProfit?.ttm, 'currency'),
      ),
    ]);

    table.rows.push([
      'Gross Margin (TTM)',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.profitability?.grossMargin?.ttm, 'percentage'),
      ),
    ]);

    table.rows.push([
      'Operating Income (TTM)',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.profitability?.operatingIncome?.ttm, 'currency'),
      ),
    ]);

    table.rows.push([
      'EBITDA (TTM)',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.profitability?.ebitda?.ttm, 'currency'),
      ),
    ]);

    // Cash flow metrics
    table.rows.push([
      'Free Cash Flow (TTM)',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.cashFlow?.freeCashFlow?.ttm, 'currency'),
      ),
    ]);

    table.rows.push([
      'Cash Conversion Ratio',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.cashFlow?.cashConversionRatio?.ttm, 'percentage'),
      ),
    ]);

    // Balance sheet metrics
    table.rows.push([
      'Current Ratio',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.balanceSheet?.currentRatio?.[0]?.value, 'percentage'),
      ),
    ]);

    table.rows.push([
      'Debt/Equity',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.balanceSheet?.debtToEquity?.[0]?.value, 'percentage'),
      ),
    ]);

    table.rows.push([
      'ROE',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.balanceSheet?.roe?.[0]?.value, 'percentage'),
      ),
    ]);

    // Valuation metrics
    table.rows.push([
      'Market Cap',
      ...tickers.map((t) =>
        this.formatValue(comparison[t]?.metrics.valuation?.marketCap, 'currency'),
      ),
    ]);

    return table;
  }

  /**
   * Format value for display
   */
  private formatValue(value: number | undefined, type: 'currency' | 'percentage'): string {
    if (value === null || value === undefined) {
      return 'N/A';
    }

    if (type === 'percentage') {
      return `${(value * 100).toFixed(2)}%`;
    }

    // Currency formatting
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
   * Get qualitative analysis from Knowledge Base with proper ticker filtering
   * Uses pre-computed cache for instant loading when available
   * GET /api/financial-calculator/qualitative/:ticker?category=companyDescription
   */
  @Get('qualitative/:ticker')
  async getQualitativeAnalysis(
    @Param('ticker') ticker: string,
    @Query('category') category?: string,
  ) {
    const upperTicker = ticker.toUpperCase();
    this.logger.log(`Getting qualitative analysis for ${upperTicker}, category: ${category || 'all'}`);

    try {
      // OPTIMIZATION: Check cache first for instant loading
      const cachedData = await this.qualitativePrecompute.getCachedQualitative(upperTicker, category);
      const hasCachedData = Object.keys(cachedData).length > 0;
      
      if (hasCachedData) {
        this.logger.log(`✅ Returning cached qualitative data for ${upperTicker} (${Object.keys(cachedData).length} categories)`);
        
        // Return cached data with indicator
        return {
          success: true,
          data: {
            ticker: upperTicker,
            categories: cachedData,
            timestamp: new Date(),
            cached: true,
          },
          message: `Qualitative analysis retrieved from cache for ${upperTicker}`,
        };
      }

      // No cache - generate on-demand (slower path)
      this.logger.log(`Cache miss for ${upperTicker} - generating on-demand`);
      
      const categories_list = category 
        ? [category] 
        : Object.keys(QUALITATIVE_QUESTIONS);

      const results: Record<string, any> = {};

      for (const cat of categories_list) {
        const questions = QUALITATIVE_QUESTIONS[cat as keyof typeof QUALITATIVE_QUESTIONS];
        if (!questions) continue;

        results[cat] = [];

        for (const questionTemplate of questions) {
          const question = questionTemplate.replace(/{ticker}/g, upperTicker);
          
          try {
            // Use semantic retriever directly with ticker filter
            const { narratives, contextualMetrics, summary } = await this.semanticRetriever.retrieveWithContext({
              query: question,
              tickers: [upperTicker], // CRITICAL: Pass ticker for filtering
              numberOfResults: 8,
            });

            let answer = 'No relevant information found in SEC filings.';
            
            // If we have narratives, try to generate an answer with Bedrock
            if (narratives.length > 0) {
              try {
                const generated = await this.bedrockService.generate(question, {
                  metrics: contextualMetrics,
                  narratives: narratives,
                  systemPrompt: `You are a senior equity research analyst at a deep-value investment fund. Your analysis must be institutional-grade.

FORMATTING REQUIREMENTS:
- Use markdown headers (##, ###) to structure your response into clear sections
- Use markdown tables (with | separators and --- header rows) for any quantitative comparisons, financial data, or multi-period data
- Use bold (**text**) for key findings, red flags, and critical numbers
- Use bullet points for lists of items
- Include specific dollar amounts, percentages, and dates from the filings
- When comparing periods, ALWAYS use a markdown table with columns for each period
- When listing items (risks, acquisitions, changes), use a structured format with clear categorization
- Aim for 400-800 words of substantive analysis
- End with a "Key Takeaway" section summarizing the investment implications in 2-3 sentences

ANALYSIS REQUIREMENTS:
- Cite specific filing types and periods (e.g., "per the FY2024 10-K")
- Quantify everything possible — avoid vague language
- Flag contradictions between management statements and actual results
- Highlight material changes year-over-year
- Note what is NOT disclosed that should be (gaps in disclosure)`,
                });
                answer = generated.answer;
              } catch (genError) {
                // Fallback: Build answer from narratives directly
                this.logger.warn(`Bedrock generation failed, using fallback: ${genError.message}`);
                answer = this.buildAnswerFromNarratives(question, narratives);
              }
            }

            results[cat].push({
              question,
              answer,
              sources: narratives.slice(0, 5).map(n => ({
                section: n.metadata.sectionType,
                filingType: n.metadata.filingType,
                fiscalPeriod: n.metadata.fiscalPeriod,
                score: n.score,
              })),
              confidence: narratives.length > 0 ? (summary.avgScore > 0.5 ? 'high' : 'medium') : 'low',
              narrativeCount: narratives.length,
              cached: false,
            });
          } catch (error) {
            this.logger.warn(`Failed to get answer for: ${question} - ${error.message}`);
            results[cat].push({
              question,
              answer: 'Unable to retrieve information from knowledge base.',
              sources: [],
              confidence: 'none',
              narrativeCount: 0,
              cached: false,
            });
          }
        }
      }

      return {
        success: true,
        data: {
          ticker: upperTicker,
          categories: results,
          timestamp: new Date(),
          cached: false,
        },
        message: `Qualitative analysis retrieved for ${upperTicker}`,
      };
    } catch (error) {
      this.logger.error(`Failed to get qualitative analysis for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to get qualitative analysis for ${ticker}`,
      };
    }
  }

  /**
   * Build answer from narratives when Bedrock generation fails
   */
  private buildAnswerFromNarratives(question: string, narratives: any[]): string {
    if (narratives.length === 0) {
      return 'No relevant information found.';
    }

    const parts: string[] = [];
    parts.push(`Based on SEC filings, here's what we found:\n`);

    for (let i = 0; i < Math.min(narratives.length, 3); i++) {
      const n = narratives[i];
      const excerpt = n.content.length > 500 ? n.content.substring(0, 500) + '...' : n.content;
      parts.push(`\n[${n.metadata.filingType} - ${n.metadata.sectionType}]`);
      parts.push(excerpt);
    }

    return parts.join('\n');
  }

  /**
   * Ask a single qualitative question with proper ticker filtering
   * POST /api/financial-calculator/ask
   */
  @Post('ask')
  async askQuestion(
    @Body() body: { ticker: string; question: string },
  ) {
    const { ticker, question } = body;
    const upperTicker = ticker.toUpperCase();
    this.logger.log(`Asking question for ${upperTicker}: ${question}`);

    try {
      const formattedQuestion = question.replace(/{ticker}/g, upperTicker);
      
      // Use semantic retriever directly with ticker filter
      const { narratives, contextualMetrics, summary } = await this.semanticRetriever.retrieveWithContext({
        query: formattedQuestion,
        tickers: [upperTicker], // CRITICAL: Pass ticker for filtering
        numberOfResults: 8,
      });

      let answer = 'No relevant information found in SEC filings for this question.';
      
      // If we have narratives, try to generate an answer with Bedrock
      if (narratives.length > 0) {
        try {
          const generated = await this.bedrockService.generate(formattedQuestion, {
            metrics: contextualMetrics,
            narratives: narratives,
          });
          answer = generated.answer;
        } catch (genError) {
          // Fallback: Build answer from narratives directly
          this.logger.warn(`Bedrock generation failed, using fallback: ${genError.message}`);
          answer = this.buildAnswerFromNarratives(formattedQuestion, narratives);
        }
      }

      return {
        success: true,
        data: {
          ticker: upperTicker,
          question: formattedQuestion,
          answer,
          sources: narratives.slice(0, 5).map(n => ({
            section: n.metadata.sectionType,
            filingType: n.metadata.filingType,
            fiscalPeriod: n.metadata.fiscalPeriod,
            score: n.score,
            excerpt: n.content.substring(0, 200) + '...',
          })),
          narrativeCount: narratives.length,
          avgScore: summary.avgScore,
          timestamp: new Date(),
        },
        message: 'Question answered successfully',
      };
    } catch (error) {
      this.logger.error(`Failed to answer question: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Failed to answer question',
      };
    }
  }

  /**
   * Get available qualitative question categories
   * GET /api/financial-calculator/qualitative-categories
   */
  @Get('qualitative-categories')
  getQualitativeCategories() {
    const categories = Object.entries(QUALITATIVE_QUESTIONS).map(([key, questions]) => ({
      id: key,
      name: this.formatCategoryName(key),
      questionCount: questions.length,
      sampleQuestion: questions[0],
    }));

    return {
      success: true,
      data: categories,
    };
  }

  /**
   * Format category name for display
   */
  private formatCategoryName(key: string): string {
    const names: Record<string, string> = {
      managementCredibility: 'Management Credibility & Alignment',
      balanceSheetProtection: 'Balance Sheet & Downside Protection',
      capitalAllocation: 'Capital Allocation & Shareholder Value',
      earningsQuality: 'Earnings Quality & Accounting Risk',
      competitiveRisk: 'Competitive Position & Risk Factors',
    };
    return names[key] || key;
  }

  /**
   * Manually trigger qualitative precomputation for a ticker
   * POST /api/financial-calculator/qualitative/precompute/:ticker
   * 
   * Use this to:
   * - Force regeneration of cached qualitative analysis
   * - Precompute analysis for a new ticker
   * - Recover from failed pipeline precomputation
   */
  @Post('qualitative/precompute/:ticker')
  async precomputeQualitative(@Param('ticker') ticker: string) {
    const upperTicker = ticker.toUpperCase();
    this.logger.log(`🧠 Manual qualitative precomputation triggered for ${upperTicker}`);

    try {
      // Check if we have narratives in PostgreSQL
      const narrativeCount = await this.financialCalculatorService.getNarrativeCount(upperTicker);
      
      if (narrativeCount === 0) {
        return {
          success: false,
          error: 'No narratives found',
          message: `Cannot precompute qualitative analysis for ${upperTicker}: no narrative chunks in database. Run the pipeline first.`,
        };
      }

      // Invalidate existing cache to force regeneration
      const invalidated = await this.qualitativePrecompute.invalidateCache(upperTicker);
      this.logger.log(`Invalidated ${invalidated} existing cache entries for ${upperTicker}`);

      // Run precomputation
      const result = await this.qualitativePrecompute.precomputeForTicker(upperTicker);

      return {
        success: true,
        data: {
          ticker: upperTicker,
          narrativesAvailable: narrativeCount,
          categoriesProcessed: result.categoriesProcessed,
          questionsAnswered: result.questionsAnswered,
          cachedFromPrevious: result.cached,
          failed: result.failed,
          durationMs: result.duration,
          durationSeconds: (result.duration / 1000).toFixed(1),
        },
        message: `Qualitative precomputation complete for ${upperTicker}: ${result.questionsAnswered} answers generated`,
      };
    } catch (error) {
      this.logger.error(`Failed to precompute qualitative for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to precompute qualitative analysis for ${ticker}`,
      };
    }
  }

  /**
   * Check qualitative cache status for a ticker
   * GET /api/financial-calculator/qualitative/status/:ticker
   */
  @Get('qualitative/status/:ticker')
  async getQualitativeStatus(@Param('ticker') ticker: string) {
    const upperTicker = ticker.toUpperCase();
    
    try {
      const hasCache = await this.qualitativePrecompute.hasValidCache(upperTicker);
      const cachedData = await this.qualitativePrecompute.getValidCache(upperTicker);
      const narrativeCount = await this.financialCalculatorService.getNarrativeCount(upperTicker);

      return {
        success: true,
        data: {
          ticker: upperTicker,
          hasValidCache: hasCache,
          cachedEntries: cachedData.length,
          narrativesInDatabase: narrativeCount,
          readyForInstantLoad: hasCache && cachedData.length >= 5,
        },
        message: hasCache 
          ? `${upperTicker} has ${cachedData.length} cached qualitative entries - ready for instant loading`
          : `${upperTicker} has no cached qualitative data - will generate on-demand`,
      };
    } catch (error) {
      this.logger.error(`Failed to get qualitative status for ${ticker}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: `Failed to get qualitative status for ${ticker}`,
      };
    }
  }
}