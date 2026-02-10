import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProvocationsPrecomputeService } from './provocations-precompute.service';
import { AnalysisModeRegistryService } from './analysis-mode-registry.service';
import { ContradictionDetectorService } from './contradiction-detector.service';
import { ManagementCredibilityService } from './management-credibility.service';
import { SentimentAnalyzerService } from './sentiment-analyzer.service';

@Controller('provocations')
export class ProvocationsController {
  private readonly logger = new Logger(ProvocationsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly precompute: ProvocationsPrecomputeService,
    private readonly modeRegistry: AnalysisModeRegistryService,
    private readonly contradictionDetector: ContradictionDetectorService,
    private readonly credibilityTracker: ManagementCredibilityService,
    private readonly sentimentAnalyzer: SentimentAnalyzerService,
  ) {}

  /**
   * POST /api/provocations/analyze - Trigger analysis for a ticker
   */
  @Post('analyze')
  async analyzeProvocations(
    @Body() body: { ticker: string; mode?: string },
  ) {
    const { ticker, mode = 'provocations' } = body;
    this.logger.log(`Analyzing provocations for ${ticker} mode=${mode}`);

    try {
      // Increment query counter
      await this.incrementQueryCounter(ticker);

      // Get or generate provocations
      const provocations = await this.precompute.getProvocations(ticker, mode);

      return {
        success: true,
        ticker,
        mode,
        provocations,
        count: provocations.length,
      };
    } catch (error) {
      this.logger.error(`Analysis failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * GET /api/provocations/:ticker - Get cached provocations
   */
  @Get(':ticker')
  async getProvocations(
    @Param('ticker') ticker: string,
    @Query('mode') mode: string = 'provocations',
  ) {
    const provocations = await this.prisma.provocation.findMany({
      where: { ticker: ticker.toUpperCase(), analysisMode: mode },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return { success: true, ticker, mode, provocations };
  }

  /**
   * GET /api/provocations/:ticker/preset/:questionId - Execute preset question
   */
  @Get(':ticker/preset/:questionId')
  async executePresetQuestion(
    @Param('ticker') ticker: string,
    @Param('questionId') questionId: string,
    @Query('mode') mode: string = 'provocations',
  ) {
    const modeConfig = this.modeRegistry.getMode(mode);
    if (!modeConfig) {
      return { success: false, error: `Unknown mode: ${mode}` };
    }

    const question = modeConfig.presetQuestions.find(q => q.id === questionId);
    if (!question) {
      return { success: false, error: `Unknown preset question: ${questionId}` };
    }

    // Increment query counter
    await this.incrementQueryCounter(ticker);

    // Get provocations (will generate if not cached)
    const provocations = await this.precompute.getProvocations(ticker, mode);

    return {
      success: true,
      ticker,
      mode,
      question: question.text,
      provocations,
    };
  }

  /**
   * POST /api/provocations/mode - Switch analysis mode
   */
  @Post('mode')
  async switchMode(@Body() body: { mode: string }) {
    const modeConfig = this.modeRegistry.getMode(body.mode);
    if (!modeConfig) {
      return { success: false, error: `Unknown mode: ${body.mode}` };
    }

    return {
      success: true,
      mode: modeConfig.name,
      description: modeConfig.description,
      presetQuestions: modeConfig.presetQuestions,
    };
  }

  /**
   * GET /api/provocations/:ticker/modes - List available modes with preset questions
   */
  @Get(':ticker/modes')
  async getAvailableModes(@Param('ticker') ticker: string) {
    const modes = this.modeRegistry.listModes();

    // Get available filing types for this ticker
    const filingTypes = await this.prisma.narrativeChunk.findMany({
      where: { ticker: ticker.toUpperCase() },
      distinct: ['filingType'],
      select: { filingType: true },
    });
    const availableTypes = filingTypes.map(f => f.filingType);

    return {
      success: true,
      ticker,
      modes: modes.map(m => ({
        name: m.name,
        description: m.description,
        presetQuestions: this.modeRegistry.getPresetQuestions(m.name, availableTypes),
      })),
    };
  }

  /**
   * GET /api/provocations/:ticker/contradictions - Get contradictions
   */
  @Get(':ticker/contradictions')
  async getContradictions(@Param('ticker') ticker: string) {
    const contradictions = await this.contradictionDetector.detectContradictions(ticker.toUpperCase());
    return { success: true, ticker, contradictions };
  }

  /**
   * GET /api/provocations/:ticker/credibility - Get management credibility
   */
  @Get(':ticker/credibility')
  async getCredibility(@Param('ticker') ticker: string) {
    const assessment = await this.credibilityTracker.compareToResults(ticker.toUpperCase());
    return { success: true, ticker, assessment };
  }

  /**
   * GET /api/provocations/:ticker/sentiment - Get sentiment analysis
   */
  @Get(':ticker/sentiment')
  async getSentiment(@Param('ticker') ticker: string) {
    const sections = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker: ticker.toUpperCase(),
        sectionType: { in: ['mda', 'MD&A'] },
      },
      orderBy: { filingDate: 'desc' },
      take: 4,
    });

    const sentiments = sections.map(s => ({
      filingDate: s.filingDate,
      filingType: s.filingType,
      sentiment: this.sentimentAnalyzer.calculateSentiment(s.content),
    }));

    // Calculate deltas between consecutive filings
    const deltas: { from: Date; to: Date; delta: any }[] = [];
    for (let i = 0; i < sentiments.length - 1; i++) {
      deltas.push({
        from: sentiments[i + 1].filingDate,
        to: sentiments[i].filingDate,
        delta: this.sentimentAnalyzer.detectSentimentDelta(
          sections[i + 1].content,
          sections[i].content,
        ),
      });
    }

    return { success: true, ticker, sentiments, deltas };
  }

  /**
   * GET /api/provocations/:ticker/query-count - Get query count
   */
  @Get(':ticker/query-count')
  async getQueryCount(@Param('ticker') ticker: string) {
    const counter = await this.prisma.researchQueryCounter.findUnique({
      where: { ticker: ticker.toUpperCase() },
    });
    return {
      success: true,
      ticker,
      queryCount: counter?.queryCount || 0,
      provocationsGenerated: counter?.provocationsGenerated || false,
    };
  }

  /**
   * GET /api/provocations/:ticker/value-investing - Get 5 pre-computed value investing provocations
   * These are generated immediately on workspace load - no waiting for 3 queries.
   */
  @Get(':ticker/value-investing')
  async getValueInvestingProvocations(@Param('ticker') ticker: string) {
    this.logger.log(`Getting value investing provocations for ${ticker}`);
    try {
      const provocations = await this.precompute.getValueInvestingProvocations(ticker);
      return {
        success: true,
        ticker: ticker.toUpperCase(),
        mode: 'value_investing_precomputed',
        provocations,
        count: provocations.length,
        description: '5 pre-computed value investing provocations for senior equity analysts',
      };
    } catch (error) {
      this.logger.error(`Value investing provocations failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private async incrementQueryCounter(ticker: string): Promise<void> {
    const upper = ticker.toUpperCase();
    await this.prisma.researchQueryCounter.upsert({
      where: { ticker: upper },
      update: {
        queryCount: { increment: 1 },
        lastQueryAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        ticker: upper,
        queryCount: 1,
        lastQueryAt: new Date(),
      },
    });

    // Check if auto-generation threshold reached
    const counter = await this.prisma.researchQueryCounter.findUnique({
      where: { ticker: upper },
    });

    if (counter && counter.queryCount >= 3 && !counter.provocationsGenerated) {
      // Trigger auto-generation in background
      this.precompute.preGenerateProvocations(upper).then(() => {
        this.prisma.researchQueryCounter.update({
          where: { ticker: upper },
          data: { provocationsGenerated: true },
        }).catch(e => this.logger.error(`Failed to update counter: ${e.message}`));
      }).catch(e => this.logger.error(`Auto-generation failed: ${e.message}`));
    }
  }
}
