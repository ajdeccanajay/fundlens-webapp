import { Controller, Get, Query, BadRequestException, Post, Body, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { SecService } from './sec.service';
import { SecParserService } from './sec-parser.service';
import { MetricsService } from './metrics.service';
import { IngestionService } from './ingestion.service';
import { SecQueryService } from './sec-query.service';
import { ComputedMetricsService, ComputedMetricResult } from './computed-metrics.service';
import { BatchIngestionService, BatchProgress } from './batch-ingestion.service';
import { HistoricalHydrationService, HydrationConfig } from './historical-hydration.service';
import { 
  CikResponseDto, 
  SubmissionsResponseDto, 
  CompanyFactsResponseDto, 
  CompanyConceptResponseDto, 
  FramesResponseDto, 
  AggregateResponseDto,
  FillingsResponseDto
} from './dto/sec.dto';

@ApiTags('SEC')
@Controller('sec')
export class SecController {
  private readonly logger = new Logger(SecController.name);

  constructor(
    private readonly sec: SecService,
    private readonly secParser: SecParserService,
    private readonly metricsService: MetricsService,
    private readonly ingestionService: IngestionService,
    private readonly queryService: SecQueryService,
    private readonly computedMetrics: ComputedMetricsService,
    private readonly batchIngestion: BatchIngestionService,
    private readonly hydrationService: HistoricalHydrationService,
  ) {}

  // 1) Ticker → CIK
  @ApiOperation({ summary: 'Lookup CIK for a stock ticker', description: 'Converts a stock ticker symbol to its corresponding CIK (Central Index Key) number' })
  @ApiQuery({ name: 'ticker', description: 'Stock ticker symbol (e.g., AAPL, MSFT)', required: true, example: 'AAPL' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved CIK information', type: CikResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request - ticker is required' })
  @Get('lookup')
  async lookup(@Query('ticker') ticker?: string) {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.sec.getCikForTicker(ticker);
  }

  // 2) Submissions
  @ApiOperation({ summary: 'Get company submissions', description: 'Retrieves SEC filing submissions for a company by ticker or CIK' })
  @ApiQuery({ name: 'ticker', description: 'Stock ticker symbol', required: false, example: 'AAPL' })
  @ApiQuery({ name: 'cik', description: 'Central Index Key (alternative to ticker)', required: false, example: '0000320193' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved company submissions', type: SubmissionsResponseDto })
  @Get('submissions')
  async submissions(@Query('ticker') ticker?: string, @Query('cik') cik?: string) {
    const CIK = cik || (await this.sec.getCikForTicker(ticker!)).cik;
    return this.sec.fetchSubmissions(CIK);
  }

  // 3) Company Facts
  @ApiOperation({ summary: 'Get company facts', description: 'Retrieves all XBRL financial facts for a company' })
  @ApiQuery({ name: 'ticker', description: 'Stock ticker symbol', required: false, example: 'AAPL' })
  @ApiQuery({ name: 'cik', description: 'Central Index Key (alternative to ticker)', required: false, example: '0000320193' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved company facts', type: CompanyFactsResponseDto })
  @Get('facts')
  async facts(@Query('ticker') ticker?: string, @Query('cik') cik?: string) {
    const CIK = cik || (await this.sec.getCikForTicker(ticker!)).cik;
    return this.sec.fetchCompanyFacts(CIK);
  }

  // 4) Company Concept (single tag)
  @ApiOperation({ summary: 'Get company concept data', description: 'Retrieves specific financial metric data for a company (e.g., Revenues, Assets)' })
  @ApiQuery({ name: 'ticker', description: 'Stock ticker symbol', required: false, example: 'AAPL' })
  @ApiQuery({ name: 'cik', description: 'Central Index Key (alternative to ticker)', required: false, example: '0000320193' })
  @ApiQuery({ name: 'tag', description: 'Financial metric tag (e.g., Revenues, Assets, Liabilities)', required: true, example: 'Revenues' })
  @ApiQuery({ name: 'taxonomy', description: 'XBRL taxonomy to use', required: false, default: 'us-gaap', example: 'us-gaap' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved company concept data', type: CompanyConceptResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request - tag is required' })
  @Get('concept')
  async concept(
    @Query('ticker') ticker?: string,
    @Query('cik') cik?: string,
    @Query('tag') tag?: string,
    @Query('taxonomy') taxonomy = 'us-gaap',
  ) {
    if (!tag) throw new BadRequestException('tag is required (e.g., Revenues)');
    const CIK = cik || (await this.sec.getCikForTicker(ticker!)).cik;
    return this.sec.fetchCompanyConcept(CIK, tag, taxonomy);
  }

  // 5) Frames (calendar-aligned)
  @ApiOperation({ summary: 'Get financial frames data', description: 'Retrieves calendar-aligned financial data across multiple companies for comparison' })
  @ApiQuery({ name: 'tag', description: 'Financial metric tag (e.g., Revenues, Assets)', required: true, example: 'Revenues' })
  @ApiQuery({ name: 'unit', description: 'Currency or unit of measurement', required: false, default: 'USD', example: 'USD' })
  @ApiQuery({ name: 'frame', description: 'Time frame for the data', required: false, default: 'CY2024Q4I', example: 'CY2024Q4I' })
  @ApiQuery({ name: 'taxonomy', description: 'XBRL taxonomy to use', required: false, default: 'us-gaap', example: 'us-gaap' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved frames data', type: FramesResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request - tag is required' })
  @Get('frames')
  async frames(
    @Query('tag') tag?: string,
    @Query('unit') unit = 'USD',
    @Query('frame') frame = 'CY2024Q4I',
    @Query('taxonomy') taxonomy = 'us-gaap',
  ) {
    if (!tag) throw new BadRequestException('tag is required (e.g., Revenues)');
    return this.sec.fetchFrames(tag, unit, frame, taxonomy);
  }

  // 6) Aggregate & (optional) save to JSON
  @ApiOperation({ summary: 'Aggregate comprehensive company data', description: 'Combines multiple data sources into a single comprehensive response for a company' })
  @ApiQuery({ name: 'ticker', description: 'Stock ticker symbol', required: true, example: 'AAPL' })
  @ApiQuery({ name: 'tag', description: 'Financial metric tag to focus on', required: false, default: 'Revenues', example: 'Revenues' })
  @ApiQuery({ name: 'unit', description: 'Currency or unit of measurement', required: false, default: 'USD', example: 'USD' })
  @ApiQuery({ name: 'frame', description: 'Time frame for the data', required: false, default: 'CY2024Q4I', example: 'CY2024Q4I' })
  @ApiQuery({ name: 'save', description: 'Whether to save the response to JSON file', required: false, example: 'true' })
  @ApiResponse({ status: 200, description: 'Successfully aggregated company data', type: AggregateResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request - ticker is required' })
  @Get('aggregate')
  async aggregate(
    @Query('ticker') ticker?: string,
    @Query('tag') tag = 'Revenues',
    @Query('unit') unit = 'USD',
    @Query('frame') frame = 'CY2024Q4I',
    @Query('save') save?: string
  ) {
    if (!ticker) throw new BadRequestException('ticker is required');
    const agg = await this.sec.aggregateForTicker(ticker, { tag, unit, frame });
    if (String(save).toLowerCase() === 'true') {
      const r = await this.sec.saveJSON(agg, `${ticker.toUpperCase()}_${tag}_${Date.now()}.json`);
      return { ...agg, _saved: r };
    }
    return agg;
  }

  // 7) SEC Filings (integrated fetch_filling functionality)
  @ApiOperation({ 
    summary: 'Get SEC filings data', 
    description: 'Retrieves comprehensive SEC filing data including 10-K, 10-Q, and 8-K forms with filtering options' 
  })
  @ApiQuery({ name: 'ticker', description: 'Stock ticker symbol', required: false, example: 'AAPL' })
  @ApiQuery({ name: 'cik', description: 'Central Index Key (alternative to ticker)', required: false, example: '0000320193' })
  @ApiQuery({ name: 'startDate', description: 'Start date for filtering (YYYY-MM-DD)', required: false, example: '2020-01-01' })
  @ApiQuery({ name: 'endDate', description: 'End date for filtering (YYYY-MM-DD)', required: false, example: '2024-12-31' })
  @ApiQuery({ name: 'formType', description: 'Filter by form type (10-K, 10-Q, 8-K, or all)', required: false, example: '10-K' })
  @ApiQuery({ name: 'includeOlderPages', description: 'Include older filing pages beyond recent filings', required: false, default: 'false', example: 'false' })
  @ApiResponse({ status: 200, description: 'Successfully retrieved SEC filings data', type: FillingsResponseDto })
  @ApiResponse({ status: 400, description: 'Bad request - either ticker or CIK is required' })
  @Get('fillings')
  async getFillings(
    @Query('ticker') ticker?: string,
    @Query('cik') cik?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('formType') formType?: string,
    @Query('includeOlderPages') includeOlderPages?: string
  ) {
    if (!ticker && !cik) {
      throw new BadRequestException('Either ticker or CIK is required');
    }
    
    const CIK = cik || (await this.sec.getCikForTicker(ticker!)).cik;
    const includeOlder = String(includeOlderPages).toLowerCase() === 'true';
    
    return this.sec.getFillings(CIK, {
      startDate,
      endDate,
      formType,
      includeOlderPages: includeOlder
    });
  }

  // 8) Parse SEC Filing with Python Parser
  @ApiOperation({ 
    summary: 'Parse and analyze SEC filing', 
    description: 'Downloads and parses a SEC filing using the Python parser, extracting structured data, tables, and XBRL metrics' 
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', example: 'AAPL' },
        cik: { type: 'string', example: '0000320193' },
        filingUrl: { type: 'string', example: 'https://www.sec.gov/Archives/edgar/data/320193/...' },
        filingType: { type: 'string', example: '10-K' },
        startDate: { type: 'string', example: '2023-09-30' },
        endDate: { type: 'string', example: '2024-09-28' },
      },
      required: ['filingUrl', 'filingType']
    }
  })
  @ApiResponse({ status: 200, description: 'Successfully parsed SEC filing' })
  @ApiResponse({ status: 400, description: 'Bad request - missing required parameters' })
  @Post('parse')
  async parseFiling(@Body() body: {
    ticker?: string;
    cik?: string;
    filingUrl: string;
    filingType: string;
    startDate?: string;
    endDate?: string;
  }) {
    if (!body.filingUrl || !body.filingType) {
      throw new BadRequestException('filingUrl and filingType are required');
    }

    let CIK = body.cik;
    if (!CIK && body.ticker) {
      const result = await this.sec.getCikForTicker(body.ticker);
      CIK = result.cik;
    }

    if (!CIK) {
      throw new BadRequestException('Either ticker or CIK is required');
    }

    // Set default dates if not provided (last fiscal year)
    const endDate = body.endDate || new Date().toISOString().split('T')[0];
    const startDate = body.startDate || new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0];

    return this.secParser.parseAndAnalyzeFiling(
      CIK,
      body.filingUrl,
      body.filingType,
      startDate,
      endDate
    );
  }

  // 9) Initialize metric mappings
  @Post('init-mappings')
  @ApiOperation({ summary: 'Initialize sample metric mappings' })
  async initMappings() {
    return this.metricsService.createSampleMappings();
  }

  // 10) Get all metric mappings
  @Get('mappings')
  @ApiOperation({ summary: 'Get all metric mappings' })
  async getMappings() {
    return this.metricsService.getAllMappings();
  }

  // 11) Ingest filing
  @Post('ingest')
  @ApiOperation({ summary: 'Download and parse SEC filing' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', example: 'AAPL' },
        cik: { type: 'string', example: '0000320193' },
        filingUrl: { type: 'string' },
        filingType: { type: 'string', example: '10-K' },
        filingDate: { type: 'string', example: '2024-11-01' },
      },
    },
  })
  async ingestFiling(@Body() body: {
    ticker: string;
    cik: string;
    filingUrl: string;
    filingType: string;
    filingDate: string;
  }) {
    return this.ingestionService.ingestFiling(
      body.ticker,
      body.cik,
      body.filingUrl,
      body.filingType,
      body.filingDate,
    );
  }

  // 12) Ingest latest AAPL 10-K (test endpoint)
  @Post('ingest-aapl')
  @ApiOperation({ summary: 'Ingest latest AAPL 10-K for testing' })
  async ingestAAPL() {
    const ticker = 'AAPL';
    const cik = '0000320193';
    
    // Get latest 10-K
    const filings = await this.sec.getFillings(cik, {
      formType: '10-K',
      includeOlderPages: false,
    });
    
    const latest = filings.allFilings[0];
    
    if (!latest.url) {
      throw new BadRequestException('Filing URL not found');
    }
    
    return this.ingestionService.ingestFiling(
      ticker,
      cik,
      latest.url,
      latest.form,
      latest.filingDate,
    );
  }

  // 11) Test with AAPL filing
  @Post('test-aapl')
  @ApiOperation({ summary: 'Test parser with AAPL 10-K' })
  async testAAPL() {
    const ticker = 'AAPL';
    const cik = '0000320193';
    const filingType = '10-K';
    
    // Get latest AAPL 10-K filing URL
    const filings = await this.sec.getFillings(cik, {
      formType: '10-K',
      includeOlderPages: false,
    });
    
    if (!filings.allFilings || filings.allFilings.length === 0) {
      throw new BadRequestException('No AAPL 10-K filings found');
    }
    
    const latestFiling = filings.allFilings[0];
    const filingUrl = latestFiling.url;
    
    if (!filingUrl) {
      throw new BadRequestException('Filing URL not found');
    }
    
    // Download HTML
    const htmlResponse = await this.secParser['httpService'].axiosRef.get(filingUrl, {
      headers: {
        'User-Agent': 'FundLensAI/1.0 (contact: test@example.com)',
      },
    });
    
    const htmlContent = htmlResponse.data;
    
    // Parse with Python parser
    const parseResponse = await this.secParser['httpService'].axiosRef.post('http://localhost:8000/sec-parser', {
      html_content: htmlContent,
      ticker,
      filing_type: filingType,
      cik,
    });
    
    const parsedData = parseResponse.data;
    
    // Save metrics to database
    if (parsedData.structured_metrics && parsedData.structured_metrics.length > 0) {
      const saved = await this.metricsService.saveMetrics(parsedData.structured_metrics);
      
      return {
        status: 'success',
        filing: {
          ticker,
          filing_type: filingType,
          url: filingUrl,
          filing_date: latestFiling.filingDate,
        },
        parsing_results: {
          total_metrics: parsedData.metadata.total_metrics,
          high_confidence_metrics: parsedData.metadata.high_confidence_metrics,
          total_narrative_chunks: parsedData.metadata.total_chunks,
          saved_to_db: saved.length,
        },
        sample_metrics: saved.slice(0, 5).map((m: any) => ({
          metric: m.normalizedMetric,
          raw_label: m.rawLabel,
          value: m.value.toString(),
          period: m.fiscalPeriod,
          confidence: m.confidenceScore,
        })),
      };
    }
    
    return {
      status: 'no_metrics_found',
      parsing_results: parsedData.metadata,
    };
  }

  // ============ QUERY ENDPOINTS ============

  // 14) Query metrics with filters
  @Get('query/metrics')
  @ApiOperation({ summary: 'Query financial metrics with flexible filters' })
  @ApiQuery({ name: 'ticker', required: false, example: 'AAPL' })
  @ApiQuery({ name: 'cik', required: false })
  @ApiQuery({ name: 'metricName', required: false, example: 'revenue' })
  @ApiQuery({ name: 'filingType', required: false, example: '10-K' })
  @ApiQuery({ name: 'startDate', required: false, example: '2023-01-01' })
  @ApiQuery({ name: 'endDate', required: false, example: '2024-12-31' })
  @ApiQuery({ name: 'limit', required: false, example: '100' })
  async queryMetrics(
    @Query('ticker') ticker?: string,
    @Query('cik') cik?: string,
    @Query('metricName') metricName?: string,
    @Query('filingType') filingType?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.queryService.queryMetrics({
      ticker,
      cik,
      metricName,
      filingType,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // 15) Get latest metrics snapshot for a ticker
  @Get('query/latest/:ticker')
  @ApiOperation({ summary: 'Get latest financial metrics for a ticker' })
  async getLatestMetrics(@Param('ticker') ticker: string) {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.queryService.getLatestMetrics(ticker);
  }

  // 16) Get time series for a specific metric
  @Get('query/timeseries/:ticker/:metric')
  @ApiOperation({ summary: 'Get time series data for a specific metric' })
  async getMetricTimeSeries(
    @Param('ticker') ticker: string,
    @Param('metric') metric: string,
  ) {
    if (!ticker || !metric) {
      throw new BadRequestException('ticker and metric are required');
    }
    return this.queryService.getMetricTimeSeries(ticker, metric);
  }

  // 17) Query narrative chunks
  @Get('query/narratives/:ticker')
  @ApiOperation({ summary: 'Query narrative text chunks from filings' })
  @ApiQuery({ name: 'sectionType', required: false })
  @ApiQuery({ name: 'searchText', required: false })
  @ApiQuery({ name: 'limit', required: false, example: '50' })
  async queryNarratives(
    @Param('ticker') ticker: string,
    @Query('sectionType') sectionType?: string,
    @Query('searchText') searchText?: string,
    @Query('limit') limit?: string,
  ) {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.queryService.queryNarratives(ticker, {
      sectionType,
      searchText,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // 18) Get available tickers in database
  @Get('query/tickers')
  @ApiOperation({ summary: 'Get list of available tickers in database' })
  async getAvailableTickers() {
    return this.queryService.getAvailableTickers();
  }

  // 19) Get available metrics for a ticker
  @Get('query/available-metrics/:ticker')
  @ApiOperation({ summary: 'Get available metrics for a ticker' })
  async getAvailableMetrics(@Param('ticker') ticker: string) {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.queryService.getAvailableMetrics(ticker);
  }

  // ============ COMPUTED METRICS ENDPOINTS ============

  // 20) Calculate EBITDA
  @Get('computed/ebitda/:ticker')
  @ApiOperation({ summary: 'Calculate EBITDA (Operating Income + D&A)' })
  @ApiQuery({ name: 'fiscalPeriod', required: false, example: 'FY2024' })
  async calculateEBITDA(
    @Param('ticker') ticker: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.computedMetrics.calculateEBITDA(ticker, fiscalPeriod);
  }

  // 21) Calculate Free Cash Flow
  @Get('computed/fcf/:ticker')
  @ApiOperation({ summary: 'Calculate Free Cash Flow (OCF - CapEx)' })
  @ApiQuery({ name: 'fiscalPeriod', required: false, example: 'FY2024' })
  async calculateFCF(
    @Param('ticker') ticker: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.computedMetrics.calculateFCF(ticker, fiscalPeriod);
  }

  // 22) Calculate TTM (Trailing Twelve Months)
  @Get('computed/ttm/:ticker/:metric')
  @ApiOperation({ summary: 'Calculate Trailing Twelve Months for a metric' })
  async calculateTTM(
    @Param('ticker') ticker: string,
    @Param('metric') metric: string,
  ): Promise<ComputedMetricResult> {
    if (!ticker || !metric) {
      throw new BadRequestException('ticker and metric are required');
    }
    return this.computedMetrics.calculateTTM(ticker, metric);
  }

  // 23) Calculate Gross Margin %
  @Get('computed/gross-margin/:ticker')
  @ApiOperation({ summary: 'Calculate Gross Margin % (Gross Profit / Revenue)' })
  @ApiQuery({ name: 'fiscalPeriod', required: false, example: 'FY2024' })
  async calculateGrossMargin(
    @Param('ticker') ticker: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.computedMetrics.calculateGrossMargin(ticker, fiscalPeriod);
  }

  // 24) Calculate Net Margin %
  @Get('computed/net-margin/:ticker')
  @ApiOperation({ summary: 'Calculate Net Margin % (Net Income / Revenue)' })
  @ApiQuery({ name: 'fiscalPeriod', required: false, example: 'FY2024' })
  async calculateNetMargin(
    @Param('ticker') ticker: string,
    @Query('fiscalPeriod') fiscalPeriod?: string,
  ): Promise<ComputedMetricResult[]> {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.computedMetrics.calculateNetMargin(ticker, fiscalPeriod);
  }

  // 25) Get available computed metrics
  @Get('computed/available/:ticker')
  @ApiOperation({ summary: 'Get list of available computed metrics for a ticker' })
  async getAvailableComputedMetrics(@Param('ticker') ticker: string) {
    if (!ticker) throw new BadRequestException('ticker is required');
    return this.computedMetrics.getAvailableComputedMetrics(ticker);
  }

  // 26) Get all metric mappings (for Python parser)
  @Get('mappings')
  @ApiOperation({ summary: 'Get all metric mappings with synonyms and XBRL tags' })
  async getMetricMappings() {
    return this.metricsService.getAllMappings();
  }

  // ============ BATCH INGESTION ENDPOINTS ============

  // 27) Batch ingest multiple companies
  @Post('batch-ingest')
  @ApiOperation({ summary: 'Ingest multiple companies in parallel' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tickers: {
          type: 'array',
          items: { type: 'string' },
          example: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA'],
        },
        maxConcurrent: {
          type: 'number',
          example: 3,
          description: 'Maximum concurrent ingestions (default: 3)',
        },
        skipExisting: {
          type: 'boolean',
          example: true,
          description: 'Skip already processed tickers (default: true)',
        },
      },
      required: ['tickers'],
    },
  })
  async batchIngest(
    @Body()
    body: {
      tickers: string[];
      maxConcurrent?: number;
      skipExisting?: boolean;
    },
  ): Promise<{ batchId: string; progress: BatchProgress }> {
    if (!body.tickers || !Array.isArray(body.tickers) || body.tickers.length === 0) {
      throw new BadRequestException('tickers array is required and must not be empty');
    }

    return this.batchIngestion.ingestBatch(body.tickers, {
      maxConcurrent: body.maxConcurrent,
      skipExisting: body.skipExisting,
    });
  }

  // 28) Get batch progress
  @Get('batch-progress/:batchId')
  @ApiOperation({ summary: 'Get progress of a batch ingestion' })
  @ApiParam({ name: 'batchId', description: 'Batch ID returned from batch-ingest' })
  async getBatchProgress(@Param('batchId') batchId: string): Promise<BatchProgress> {
    const progress = this.batchIngestion.getBatchProgress(batchId);
    if (!progress) {
      throw new BadRequestException('Batch ID not found');
    }
    return progress;
  }

  // 29) Get all ingested tickers
  @Get('ingested-tickers')
  @ApiOperation({ summary: 'Get list of all ingested tickers with stats' })
  async getIngestedTickers() {
    return this.batchIngestion.getIngestedTickers();
  }

  // 30) Quick batch ingest (top 10 companies)
  @Post('batch-ingest-top10')
  @ApiOperation({ summary: 'Ingest top 10 companies (AAPL, MSFT, GOOGL, AMZN, TSLA, META, NVDA, JPM, BAC, WFC)' })
  async batchIngestTop10(): Promise<{ batchId: string; progress: BatchProgress }> {
    const top10 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'BAC', 'WFC'];
    return this.batchIngestion.ingestBatch(top10, {
      maxConcurrent: 3,
      skipExisting: true,
    });
  }

  // 31) Clear and re-ingest a ticker (for debugging)
  @Post('reingest/:ticker')
  @ApiOperation({ summary: 'Clear and re-ingest a specific ticker' })
  @ApiParam({ name: 'ticker', description: 'Ticker to re-ingest' })
  async reingestTicker(@Param('ticker') ticker: string) {
    const upperTicker = ticker.toUpperCase();
    
    // Clear existing data
    await this.metricsService.clearTickerData(upperTicker);
    
    // Re-ingest
    return this.batchIngestion.ingestBatch([upperTicker], {
      maxConcurrent: 1,
      skipExisting: false,
    });
  }

  // ============ HISTORICAL HYDRATION ENDPOINTS ============

  // 32) Start historical data hydration
  @Post('hydration/start')
  @ApiOperation({ 
    summary: 'Start historical data hydration',
    description: 'Begin systematic download and processing of historical SEC filings for multiple companies'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        tickers: {
          type: 'array',
          items: { type: 'string' },
          example: ['AAPL', 'MSFT', 'GOOGL'],
          description: 'List of ticker symbols to process'
        },
        startYear: {
          type: 'number',
          example: 2018,
          description: 'Starting year for data collection'
        },
        endYear: {
          type: 'number',
          example: 2025,
          description: 'Ending year for data collection'
        },
        filingTypes: {
          type: 'array',
          items: { type: 'string' },
          example: ['10-K', '10-Q', '8-K'],
          description: 'Types of SEC filings to process'
        },
        maxConcurrent: {
          type: 'number',
          example: 3,
          description: 'Maximum concurrent processing tasks'
        },
        skipExisting: {
          type: 'boolean',
          example: true,
          description: 'Skip already processed filings'
        }
      },
      required: ['tickers', 'startYear', 'endYear', 'filingTypes']
    }
  })
  async startHydration(@Body() body: {
    tickers: string[];
    startYear: number;
    endYear: number;
    filingTypes: string[];
    maxConcurrent?: number;
    skipExisting?: boolean;
  }) {
    this.logger.log(`🚀 Starting hydration for ${body.tickers.length} companies: ${body.tickers.join(', ')}`);

    const config: HydrationConfig = {
      tickers: body.tickers,
      startYear: body.startYear,
      endYear: body.endYear,
      filingTypes: body.filingTypes,
      maxConcurrent: body.maxConcurrent || 3,
      skipExisting: body.skipExisting ?? true,
    };

    const summary = await this.hydrationService.startHydration(config);

    return {
      message: 'Historical data hydration started successfully',
      summary,
    };
  }

  // 33) Get hydration progress
  @Get('hydration/progress')
  @ApiOperation({ 
    summary: 'Get hydration progress',
    description: 'Retrieve current progress of historical data hydration'
  })
  getHydrationProgress() {
    const progress = this.hydrationService.getProgress();
    
    if (!progress) {
      return { message: 'No hydration currently in progress' };
    }

    return progress;
  }

  // 34) Get ticker-specific hydration progress
  @Get('hydration/progress/:ticker')
  @ApiOperation({ 
    summary: 'Get ticker-specific progress',
    description: 'Retrieve hydration progress for a specific ticker'
  })
  getTickerHydrationProgress(@Param('ticker') ticker: string) {
    const progress = this.hydrationService.getTickerProgress(ticker.toUpperCase());
    
    return {
      ticker: ticker.toUpperCase(),
      progress,
    };
  }

  // 35) Get hydration report
  @Get('hydration/report')
  @ApiOperation({ 
    summary: 'Get hydration report',
    description: 'Generate a comprehensive report of the hydration process'
  })
  getHydrationReport() {
    const report = this.hydrationService.generateReport();
    
    return {
      report,
      timestamp: new Date(),
    };
  }

  // 36) Start standard 7-year hydration
  @Post('hydration/start-standard')
  @ApiOperation({ 
    summary: 'Start standard 7-year hydration',
    description: 'Start hydration for the standard 10 companies with 7 years of data (2018-2025)'
  })
  async startStandardHydration() {
    this.logger.log('🚀 Starting standard 7-year hydration for 10 companies');

    const config: HydrationConfig = {
      tickers: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'JPM', 'BAC', 'WMT'],
      startYear: 2018,
      endYear: 2025,
      filingTypes: ['10-K', '10-Q', '8-K'],
      maxConcurrent: 3,
      skipExisting: true,
    };

    const summary = await this.hydrationService.startHydration(config);

    return {
      message: 'Standard 7-year historical data hydration started successfully',
      config,
      summary,
    };
  }
}
