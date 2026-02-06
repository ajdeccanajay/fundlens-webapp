import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { QueryRouterService } from './query-router.service';
import { RAGService } from './rag.service';
import { PerformanceMonitorService } from './performance-monitor.service';

@ApiTags('rag')
@Controller('rag')
export class RAGController {
  constructor(
    private readonly queryRouter: QueryRouterService,
    private readonly ragService: RAGService,
    private readonly performanceMonitor: PerformanceMonitorService,
  ) {}

  @Post('detect-intent')
  @ApiOperation({ summary: 'Detect intent from natural language query' })
  async detectIntent(@Body('query') query: string) {
    const intent = await this.queryRouter.getIntent(query);
    return {
      query,
      intent,
      timestamp: new Date(),
    };
  }

  @Post('route')
  @ApiOperation({ summary: 'Route query to retrieval strategy' })
  async route(@Body('query') query: string) {
    const plan = await this.queryRouter.route(query);
    return {
      query,
      plan,
      timestamp: new Date(),
    };
  }

  @Post('test-batch')
  @ApiOperation({ summary: 'Test multiple queries at once' })
  async testBatch(@Body('queries') queries: string[]) {
    const results = await Promise.all(
      queries.map(async (query) => {
        const intent = await this.queryRouter.getIntent(query);
        const plan = await this.queryRouter.route(query);
        return { query, intent, plan };
      }),
    );

    return {
      total: queries.length,
      results,
      timestamp: new Date(),
    };
  }

  @Get('test-queries')
  @ApiOperation({ summary: 'Get sample test queries' })
  getTestQueries() {
    return {
      structured: [
        "What was Apple's revenue in FY2024?",
        "What is MSFT's latest net income?",
        "Compare AAPL and GOOGL revenue",
        "What's Tesla's cash position?",
        "Show me Amazon's total assets",
      ],
      semantic: [
        "Explain Apple's business model",
        "What are Microsoft's main risk factors?",
        "Describe Tesla's strategy",
        "Latest news on Amazon",
        "What does Google say about AI?",
      ],
      hybrid: [
        "Why did Apple's revenue grow in 2024?",
        "How did Microsoft's cloud revenue impact margins?",
        "What drove Tesla's profitability improvement?",
        "Explain Amazon's revenue decline",
        "Why did Google's expenses increase?",
      ],
    };
  }

  @Post('query')
  @ApiOperation({ summary: 'Execute RAG query (full pipeline)' })
  async query(
    @Body('query') query: string,
    @Body('options') options?: any,
  ) {
    return this.ragService.query(query, options);
  }

  @Post('test-structured')
  @ApiOperation({ summary: 'Test structured retrieval only' })
  async testStructured(@Body() query: any) {
    return this.ragService.testStructuredRetrieval(query);
  }

  @Post('test-comparison')
  @ApiOperation({ summary: 'Test multi-company comparison' })
  async testComparison(
    @Body('tickers') tickers: string[],
    @Body('metrics') metrics: string[],
    @Body('period') period?: string,
  ) {
    return this.ragService.testComparison(tickers, metrics, period);
  }

  @Post('test-timeseries')
  @ApiOperation({ summary: 'Test time series retrieval' })
  async testTimeSeries(
    @Body('ticker') ticker: string,
    @Body('metric') metric: string,
    @Body('filingType') filingType?: string,
  ) {
    return this.ragService.testTimeSeries(ticker, metric, filingType);
  }

  @Get('performance')
  @ApiOperation({ summary: 'Get performance metrics' })
  getPerformanceMetrics() {
    return this.performanceMonitor.exportMetrics();
  }

  @Get('performance/health')
  @ApiOperation({ summary: 'Get performance health status' })
  getPerformanceHealth() {
    return this.performanceMonitor.getHealthStatus();
  }

  @Post('performance/reset')
  @ApiOperation({ summary: 'Reset performance metrics (testing only)' })
  resetPerformanceMetrics() {
    this.performanceMonitor.reset();
    return { message: 'Performance metrics reset successfully' };
  }
}
