import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RAGService } from '../rag/rag.service';
import { BedrockService } from '../rag/bedrock.service';
import { SemanticRetrieverService } from '../rag/semantic-retriever.service';
import { FinancialCalculatorService } from './financial-calculator.service';
import { MarketDataService } from './market-data.service';

export interface DocumentGenerationRequest {
  ticker: string;
  dealId?: string; // Optional for backward compatibility
  structure?: string;
  customSections?: string;
  voiceTone?: string;
  content: string;
  fundCriteria?: {
    mandate: string;
    checks: string;
    risks: string;
  };
}

export interface PresentationGenerationRequest {
  ticker: string;
  dealId?: string; // Optional for backward compatibility
  presentationType: string;
  slideCount: string;
  includeCharts: {
    financial: boolean;
    competitor: boolean;
  };
  content: string;
  metrics?: any;
  competitors?: any[];
}

export interface MemoAnalysisRequest {
  content: string;
  fundCriteria: {
    mandate: string;
    checks: string;
    risks: string;
  };
  ticker?: string;
}

/**
 * Document Generation Service
 * Handles investment memo and presentation generation using LLM
 */
@Injectable()
export class DocumentGenerationService {
  private readonly logger = new Logger(DocumentGenerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RAGService,
    private readonly financialCalculatorService: FinancialCalculatorService,
    private readonly bedrockService: BedrockService,
    private readonly marketDataService: MarketDataService,
    private readonly semanticRetrieverService: SemanticRetrieverService,
  ) {}

  /**
   * Generate investment memorandum with streaming support
   */
  /**
     * Investment-Grade IC Memo Generation Pipeline
     * Per spec: Multi-stage pipeline with section-by-section generation,
     * provocation integration, and citation metadata propagation.
     * NOT a single LLM call.
     */
    async generateInvestmentMemoStreaming(
      request: DocumentGenerationRequest,
      onChunk: (chunk: { type: string; content?: string; status?: string; message?: string; data?: any }) => void
    ): Promise<void> {
      this.logger.log(`Generating investment-grade IC memo for ticker: ${request.ticker}`);

      try {
        const ticker = request.ticker;

        // ═══ STAGE 1: Data Assembly (Spec §2.1 Stage 2) ═══
        onChunk({ type: 'status', status: 'gathering_data', message: 'Assembling financial data, narratives, and provocations...' });

        const [metrics, marketData, narrativeContext, provocations] = await Promise.all([
          this.getMetricsForMemo(ticker),
          this.getMarketDataForMemo(ticker),
          this.getNarrativeContextForMemo(ticker),
          this.getProvocationsForMemo(ticker),
        ]);

        onChunk({ type: 'status', status: 'data_gathered', message: `Data assembled: ${narrativeContext.length} narrative chunks, ${provocations.length} provocations. Generating sections...` });

        // ═══ STAGE 2: Section-by-Section Generation (Spec §2.1 Stage 3, §3.2, §7.1) ═══
        // Each section is a separate LLM call with focused context (Spec Principle 6)
        const memoSections = this.getDefaultMemoTemplate();
        const assembledData = {
          ticker,
          companyName: `${ticker} Inc.`,
          metrics,
          marketData,
          narrativeContext,
          provocations,
          userContent: request.content,
          fundCriteria: request.fundCriteria,
        };

        let fullMemoContent = '';

        for (let i = 0; i < memoSections.length; i++) {
          const section = memoSections[i];
          onChunk({
            type: 'status',
            status: 'generating_section',
            message: `Generating section ${i + 1}/${memoSections.length}: ${section.name}...`,
          });

          const sectionContent = await this.generateMemoSection(section, assembledData);
          fullMemoContent += sectionContent + '\n\n';

          // Stream each section as it completes
          onChunk({ type: 'content', content: sectionContent + '\n\n' });
        }

        // ═══ STAGE 3: Save ═══
        onChunk({ type: 'status', status: 'saving', message: 'Saving memo...' });

        const documentId = await this.saveGeneratedDocument({
          ticker,
          dealId: request.dealId || null,
          type: 'investment_memo',
          content: fullMemoContent,
          metadata: {
            structure: 'section_by_section',
            voiceTone: request.voiceTone || 'professional',
            wordCount: fullMemoContent.split(' ').length,
            sectionCount: memoSections.length,
            provocationsIncluded: provocations.length,
            generatedAt: new Date().toISOString(),
          },
        });

        onChunk({
          type: 'result',
          status: 'complete',
          data: {
            content: fullMemoContent,
            downloadUrl: `/api/deals/documents/${documentId}/download`,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to generate IC memo: ${error.message}`);
        throw error;
      }
    }

  // ═══════════════════════════════════════════════════════════════
  // DEFAULT MEMO TEMPLATE (Spec §3.2)
  // When no firm-specific template exists, use this opinionated
  // deep-value equity analysis template.
  // ═══════════════════════════════════════════════════════════════

  private getDefaultMemoTemplate(): Array<{
    name: string;
    order: number;
    description: string;
    dataSources: string[];
    typicalLength: string;
  }> {
    return [
      {
        name: 'Investment Thesis',
        order: 1,
        description: '1-2 paragraph thesis statement with position (long/short/avoid), conviction level, and 3 key reasons. Concise and decisive.',
        dataSources: ['userContent', 'marketData'],
        typicalLength: '1-2 paragraphs',
      },
      {
        name: 'Company Overview',
        order: 2,
        description: 'Business description, segments, geographic mix, competitive positioning. NOT a Wikipedia summary — focused on what matters for the thesis.',
        dataSources: ['narrativeContext'],
        typicalLength: '2-3 paragraphs',
      },
      {
        name: 'Financial Analysis',
        order: 3,
        description: 'Key metrics table (5-year trends), margin analysis, capital allocation review, balance sheet assessment. All deterministically extracted. Include markdown tables.',
        dataSources: ['metrics', 'marketData'],
        typicalLength: '4-6 paragraphs with tables',
      },
      {
        name: 'Management & Governance',
        order: 4,
        description: 'Executive assessment, compensation alignment, MD&A language analysis. Uses management commentary from filings to assess credibility and strategic clarity.',
        dataSources: ['narrativeContext'],
        typicalLength: '2-3 paragraphs',
      },
      {
        name: 'Variant Perception',
        order: 5,
        description: 'Where does our view differ from consensus? What does the market miss? What are we seeing that others aren\'t? This is the analytical core.',
        dataSources: ['userContent', 'provocations'],
        typicalLength: '2-3 paragraphs',
      },
      {
        name: 'Key Risks & Counter-Arguments',
        order: 6,
        description: 'Provocations presented as structured challenges. Each risk: the challenge, the data, the analyst\'s response, the residual exposure. Per spec §6.2.',
        dataSources: ['provocations', 'userContent'],
        typicalLength: '3-5 risk items',
      },
      {
        name: 'Valuation',
        order: 7,
        description: 'Valuation methodology with comps where applicable. Sensitivity analysis on key assumptions. Target price or range with timeline.',
        dataSources: ['metrics', 'marketData', 'userContent'],
        typicalLength: '2-3 paragraphs with table',
      },
      {
        name: 'Catalysts & Monitoring Plan',
        order: 8,
        description: 'Upcoming events that could move the stock. What to watch for. Kill criteria — what would invalidate the thesis?',
        dataSources: ['userContent', 'narrativeContext'],
        typicalLength: '1-2 paragraphs with bullet list',
      },
    ];
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION-BY-SECTION GENERATION (Spec §7.1, Principle 6)
  // Each section gets a dedicated LLM call with focused context.
  // ═══════════════════════════════════════════════════════════════

  private async generateMemoSection(
    section: { name: string; order: number; description: string; dataSources: string[]; typicalLength: string },
    data: {
      ticker: string;
      companyName: string;
      metrics: any;
      marketData: any;
      narrativeContext: any[];
      provocations: any[];
      userContent: string;
      fundCriteria?: any;
    },
  ): Promise<string> {
    const { ticker, companyName, metrics, marketData, narrativeContext, provocations, userContent, fundCriteria } = data;

    // Build section-specific system prompt (Spec §7.1)
    const systemPrompt = `You are writing the "${section.name}" section of an Investment Committee memo for ${companyName} (${ticker}).

<section_description>
${section.description}
</section_description>

RULES:
1. Use inline citations from the provided data. Each SEC filing excerpt is labeled with its source — cite as (Filing Type, Date, Section), e.g. (10-K, 2024-06-30, MD&A). Financial metrics are derived from SEC filings — cite as (SEC Filings, Computed).
2. Do NOT use [NEEDS SOURCE] tags. All data provided below is sourced from SEC filings or live market feeds. If a claim uses provided data, cite it. If a claim is your analytical inference, no citation is needed — that's expected in an IC memo.
3. Write for the IC audience: senior portfolio managers who want insight, not summary.
4. Target length: ${section.typicalLength}
5. Use markdown formatting: ## for the section header, **bold** for key figures, tables where appropriate.
6. Be specific and data-driven. No generic filler.`;

    // Build section-specific user prompt with only relevant data
    let prompt = `## ${section.name}\n\nGenerate this section using the following data:\n\n`;

    // Include market data for sections that need it
    if (section.dataSources.includes('marketData') && marketData) {
      prompt += `MARKET DATA (live feed — cite as "(Market Data, Live)"):\n`;
      prompt += `• Price: $${marketData.price?.toFixed(2) || 'N/A'} | Market Cap: ${marketData.marketCapFormatted || 'N/A'}`;
      if (marketData.fiftyTwoWeekHigh && marketData.fiftyTwoWeekLow) {
        prompt += ` | 52W: $${marketData.fiftyTwoWeekLow.toFixed(2)}-$${marketData.fiftyTwoWeekHigh.toFixed(2)}`;
      }
      prompt += `\n\n`;
    }

    // Include financial metrics for sections that need them
    if (section.dataSources.includes('metrics') && metrics) {
      prompt += this.formatMetricsForSection(section.name, metrics);
    }

    // Include narrative context for sections that need it
    if (section.dataSources.includes('narrativeContext') && narrativeContext.length > 0) {
      prompt += this.formatNarrativesForSection(section.name, narrativeContext);
    }

    // Include provocations for risk/variant sections (Spec §6)
    if (section.dataSources.includes('provocations') && provocations.length > 0) {
      prompt += this.formatProvocationsForSection(section.name, provocations);
    }

    // Include analyst notes for sections that need them
    if (section.dataSources.includes('userContent') && userContent) {
      prompt += `ANALYST'S SCRATCHPAD NOTES:\n${userContent}\n\n`;
    }

    // Include fund criteria where relevant
    if (fundCriteria && (section.name === 'Investment Thesis' || section.name === 'Key Risks & Counter-Arguments')) {
      prompt += `FUND CRITERIA:\n`;
      if (fundCriteria.mandate) prompt += `• Mandate: ${fundCriteria.mandate}\n`;
      if (fundCriteria.checks) prompt += `• Checks: ${fundCriteria.checks}\n`;
      if (fundCriteria.risks) prompt += `• Risk Parameters: ${fundCriteria.risks}\n`;
      prompt += `\n`;
    }

    prompt += `Write the "${section.name}" section now. Start with ## ${section.name} as the header.`;

    try {
      const content = await this.bedrockService.invokeClaude({
        prompt,
        systemPrompt,
        modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
        max_tokens: 4000,
        temperature: 0.3,
      });
      return content;
    } catch (error) {
      this.logger.error(`Failed to generate section "${section.name}": ${error.message}`);
      return `## ${section.name}\n\n*[Generation failed for this section. Error: ${error.message}]*\n`;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // DATA FORMATTING HELPERS (per-section context assembly)
  // ═══════════════════════════════════════════════════════════════

  private formatMetricsForSection(sectionName: string, metrics: any): string {
    if (!metrics?.metrics) return '';
    const m = metrics.metrics;
    let out = 'FINANCIAL DATA (derived from SEC filings — cite as "(SEC Filings, Computed)"):\n';

    const fmtVal = (v: number, div = 1, suffix = '', pct = false) => {
      if (v == null) return 'N/A';
      return pct ? `${(v * 100).toFixed(1)}%` : div > 1 ? `$${(v / div).toFixed(2)}${suffix}` : `${v.toFixed(2)}${suffix}`;
    };
    const fmtArr = (arr: any[], label: string, div = 1, suffix = '', pct = false) => {
      if (!arr?.length) return '';
      return `  ${label}: ${arr.slice(0, 5).map(i => `${i.period}: ${fmtVal(i.value, div, suffix, pct)}`).join(' | ')}\n`;
    };

    // Revenue
    if (m.revenue?.ttm) out += `  Revenue (TTM): $${(m.revenue.ttm / 1e9).toFixed(2)}B\n`;
    if (m.revenue?.cagr) out += `  Revenue CAGR: ${(m.revenue.cagr * 100).toFixed(1)}%\n`;
    out += fmtArr(m.revenue?.annual, 'Annual Revenue', 1e9, 'B');
    out += fmtArr(m.revenue?.yoyGrowth, 'YoY Growth', 1, '', true);

    // Profitability (full for Financial Analysis, summary for others)
    if (sectionName === 'Financial Analysis') {
      if (m.profitability?.grossMargin?.ttm) out += `  Gross Margin (TTM): ${(m.profitability.grossMargin.ttm * 100).toFixed(1)}%\n`;
      out += fmtArr(m.profitability?.grossMargin?.annual, 'Gross Margin', 1, '', true);
      if (m.profitability?.operatingMargin?.ttm) out += `  Operating Margin (TTM): ${(m.profitability.operatingMargin.ttm * 100).toFixed(1)}%\n`;
      out += fmtArr(m.profitability?.operatingMargin?.annual, 'Operating Margin', 1, '', true);
      if (m.profitability?.operatingIncome?.ttm) out += `  Operating Income (TTM): $${(m.profitability.operatingIncome.ttm / 1e9).toFixed(2)}B\n`;
      out += fmtArr(m.profitability?.operatingIncome?.annual, 'Operating Income', 1e9, 'B');
      if (m.profitability?.ebitda?.ttm) out += `  EBITDA (TTM): $${(m.profitability.ebitda.ttm / 1e9).toFixed(2)}B\n`;
      out += fmtArr(m.profitability?.ebitdaMargin?.annual, 'EBITDA Margin', 1, '', true);
      if (m.profitability?.netIncome?.ttm) out += `  Net Income (TTM): $${(m.profitability.netIncome.ttm / 1e9).toFixed(2)}B\n`;
      if (m.profitability?.netMargin?.ttm) out += `  Net Margin (TTM): ${(m.profitability.netMargin.ttm * 100).toFixed(1)}%\n`;
      out += fmtArr(m.profitability?.netIncome?.annual, 'Net Income', 1e9, 'B');

      // Cash Flow
      if (m.cashFlow?.operatingCashFlow?.ttm) out += `  OCF (TTM): $${(m.cashFlow.operatingCashFlow.ttm / 1e9).toFixed(2)}B\n`;
      out += fmtArr(m.cashFlow?.operatingCashFlow?.annual, 'OCF', 1e9, 'B');
      if (m.cashFlow?.freeCashFlow?.ttm) out += `  FCF (TTM): $${(m.cashFlow.freeCashFlow.ttm / 1e9).toFixed(2)}B\n`;
      out += fmtArr(m.cashFlow?.freeCashFlow?.annual, 'FCF', 1e9, 'B');
      if (m.cashFlow?.capexPctRevenue?.ttm) out += `  CapEx % Revenue: ${(m.cashFlow.capexPctRevenue.ttm * 100).toFixed(1)}%\n`;

      // Balance Sheet
      out += fmtArr(m.balanceSheet?.currentRatio, 'Current Ratio');
      out += fmtArr(m.balanceSheet?.debtToEquity, 'Debt/Equity');
      out += fmtArr(m.balanceSheet?.roe, 'ROE', 1, '', true);

      // Working Capital
      out += fmtArr(m.workingCapital?.dso, 'DSO');
      out += fmtArr(m.workingCapital?.cashConversionCycle, 'Cash Conversion Cycle');
    } else {
      // Summary for non-financial sections
      if (m.revenue?.ttm) out += `  Revenue (TTM): $${(m.revenue.ttm / 1e9).toFixed(2)}B\n`;
      if (m.profitability?.netMargin?.ttm) out += `  Net Margin: ${(m.profitability.netMargin.ttm * 100).toFixed(1)}%\n`;
      if (m.cashFlow?.freeCashFlow?.ttm) out += `  FCF (TTM): $${(m.cashFlow.freeCashFlow.ttm / 1e9).toFixed(2)}B\n`;
    }

    return out + '\n';
  }

  private formatNarrativesForSection(sectionName: string, narratives: any[]): string {
    // Filter narratives relevant to this section
    const sectionTypeMap: Record<string, string[]> = {
      'Company Overview': ['business', 'financial_overview'],
      'Financial Analysis': ['mda', 'financial_overview'],
      'Management & Governance': ['mda'],
      'Key Risks & Counter-Arguments': ['risk_factors'],
      'Catalysts & Monitoring Plan': ['mda', 'risk_factors'],
    };

    const relevantTypes = sectionTypeMap[sectionName] || [];
    let filtered = relevantTypes.length > 0
      ? narratives.filter(n => relevantTypes.includes(n.sectionType))
      : narratives;

    // If no filtered results, use all narratives
    if (filtered.length === 0) filtered = narratives;

    if (filtered.length === 0) return '';

    let out = `SEC FILING EXCERPTS (use these as citation sources — cite as the label shown before each excerpt):\n`;
    for (const chunk of filtered.slice(0, 5)) {
      const content = chunk.content || chunk.text || '';
      const filingType = chunk.filingType || 'Filing';
      const filingDate = chunk.filingDate ? new Date(chunk.filingDate).toISOString().split('T')[0] : '';
      const sectionLabel = (chunk.sectionType || 'general').replace(/_/g, ' ').toUpperCase();
      const citationKey = `(${filingType}${filingDate ? ', ' + filingDate : ''}, ${sectionLabel})`;
      out += `--- SOURCE: ${citationKey} ---\n${content.substring(0, 800)}\n\n`;
    }
    return out;
  }

  private formatProvocationsForSection(sectionName: string, provocations: any[]): string {
    if (provocations.length === 0) return '';

    let out = `PROVOCATIONS & CHALLENGES (from FundLens provocation engine):\n\n`;

    // Per Spec §6.2: Each provocation follows 4-part structure
    for (let i = 0; i < Math.min(provocations.length, 5); i++) {
      const p = provocations[i];
      out += `RISK ${i + 1}: ${p.title || 'Untitled'}\n`;
      out += `  Severity: ${p.severity || 'medium'} | Category: ${p.category || 'general'}\n`;
      out += `  The Challenge: ${p.challengeQuestion || p.observation || ''}\n`;
      out += `  The Evidence: ${p.observation || ''}\n`;
      if (p.crossFilingDelta) out += `  Cross-Filing Delta: ${p.crossFilingDelta}\n`;
      out += `  Implication: ${p.implication || ''}\n`;
      out += `\n`;
    }

    if (sectionName === 'Key Risks & Counter-Arguments') {
      out += `INSTRUCTIONS: Present each provocation using the 4-part structure:\n`;
      out += `1. **The Challenge** — Frame as a question the IC must address\n`;
      out += `2. **The Evidence** — Specific data points with filing citations\n`;
      out += `3. **Analyst Response** — If analyst addressed this in scratchpad, include their reasoning. Otherwise: "Not yet addressed — requires IC discussion."\n`;
      out += `4. **Residual Exposure** — What risk remains even after the response?\n\n`;
    }

    return out;
  }

  // ═══════════════════════════════════════════════════════════════
  // PROVOCATION RETRIEVAL (Spec §6)
  // ═══════════════════════════════════════════════════════════════

  private async getProvocationsForMemo(ticker: string): Promise<any[]> {
    try {
      const provocations = await this.prisma.provocation.findMany({
        where: { ticker: ticker.toUpperCase() },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      this.logger.log(`Retrieved ${provocations.length} provocations for ${ticker} memo`);
      return provocations;
    } catch (error) {
      this.logger.warn(`Failed to get provocations for memo: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate investment memorandum (non-streaming, kept for backward compatibility)
   */
  async generateInvestmentMemo(request: DocumentGenerationRequest): Promise<{
    content: string;
    downloadUrl: string;
  }> {
    this.logger.log(`Generating investment memo for ticker: ${request.ticker}`);

    try {
      // Use ticker directly instead of looking up deal
      const ticker = request.ticker;
      
      // Get comprehensive data
      const [metrics, marketData, narrativeContext] = await Promise.all([
        this.getMetricsForMemo(ticker),
        this.getMarketDataForMemo(ticker),
        this.getNarrativeContextForMemo(ticker)
      ]);

      // Build comprehensive prompt for LLM
      const prompt = this.buildMemoPrompt({
        ticker,
        companyName: `${ticker} Inc.`, // Default company name
        metrics,
        marketData,
        narrativeContext,
        userContent: request.content,
        fundCriteria: request.fundCriteria,
        structure: request.structure,
        voiceTone: request.voiceTone,
        customSections: request.customSections
      });

      // Generate memo using Claude Opus (best for writing)
      const generatedMemo = await this.generateWithClaudeOpus(prompt, 'investment_memo');

      // Save generated document (use ticker as identifier if no dealId)
      const documentId = await this.saveGeneratedDocument({
        ticker: ticker,
        dealId: request.dealId || null,
        type: 'investment_memo',
        content: generatedMemo.content,
        metadata: {
          structure: request.structure,
          voiceTone: request.voiceTone,
          wordCount: generatedMemo.content.split(' ').length
        }
      });

      return {
        content: generatedMemo.content,
        downloadUrl: `/api/deals/documents/${documentId}/download`
      };

    } catch (error) {
      this.logger.error(`Failed to generate investment memo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate PowerPoint presentation
   */
  async generatePowerPointDeck(request: PresentationGenerationRequest): Promise<{
    slides: any[];
    downloadUrl: string;
  }> {
    this.logger.log(`Generating PowerPoint deck for ticker: ${request.ticker}`);

    try {
      // TODO: Update this method to work without deal lookup
      // For now, create a minimal deal object from ticker
      const deal = {
        ticker: request.ticker,
        companyName: `${request.ticker} Inc.`
      };

      // Build presentation structure
      const slideStructure = this.buildSlideStructure(
        request.presentationType,
        parseInt(request.slideCount),
        request.includeCharts
      );

      // Generate content for each slide
      const slides: any[] = [];
      for (const slideTemplate of slideStructure) {
        const slideContent = await this.generateSlideContent({
          template: slideTemplate,
          deal,
          metrics: request.metrics,
          competitors: request.competitors || [],
          userContent: request.content
        });
        slides.push(slideContent);
      }

      // Save generated presentation
      const documentId = await this.saveGeneratedDocument({
        ticker: request.ticker,
        dealId: request.dealId || null,
        type: 'presentation',
        content: JSON.stringify(slides),
        metadata: {
          presentationType: request.presentationType,
          slideCount: slides.length,
          includeCharts: request.includeCharts
        }
      });

      return {
        slides,
        downloadUrl: `/api/deals/documents/${documentId}/download`
      };

    } catch (error) {
      this.logger.error(`Failed to generate PowerPoint deck: ${error.message}`);
      throw error;
    }
  }

  /**
   * Analyze memo for risks and compliance
   */
  async analyzeMemoWithLLM(request: MemoAnalysisRequest): Promise<{
    analysis: string;
    riskScore: number;
    complianceIssues: string[];
    recommendations: string[];
  }> {
    this.logger.log(`Analyzing memo with LLM for ticker: ${request.ticker}`);

    try {
      // Build analysis prompt
      const analysisPrompt = this.buildAnalysisPrompt(request);

      // Use Claude Opus for detailed analysis
      const analysis = await this.generateWithClaudeOpus(analysisPrompt, 'memo_analysis');

      // Parse analysis results
      const parsedResults = this.parseAnalysisResults(analysis.content);

      return parsedResults;

    } catch (error) {
      this.logger.error(`Failed to analyze memo: ${error.message}`);
      throw error;
    }
  }

  /**
   * Build memo generation prompt
   */
  private buildMemoPrompt(data: {
      ticker: string;
      companyName: string;
      metrics: any;
      marketData: any;
      narrativeContext: any;
      userContent: string;
      fundCriteria?: any;
      structure?: string;
      voiceTone?: string;
      customSections?: string;
    }): string {
      const { ticker, companyName, metrics, marketData, narrativeContext, userContent, fundCriteria, structure, voiceTone } = data;

      let prompt = `You are a senior equity research analyst at a top-tier institutional investment fund. Write a comprehensive, investment-grade memorandum for the Investment Committee. This memo must be thorough, data-driven, and demonstrate deep analytical rigor.\n\n`;

      // ── Company & Market Context ──
      prompt += `═══════════════════════════════════════\n`;
      prompt += `COMPANY: ${companyName} (${ticker})\n`;
      prompt += `═══════════════════════════════════════\n\n`;

      if (marketData) {
        prompt += `MARKET DATA (Live):\n`;
        prompt += `• Current Price: $${marketData.price?.toFixed(2) || 'N/A'}\n`;
        prompt += `• Market Cap: ${marketData.marketCapFormatted || 'N/A'}\n`;
        if (marketData.changePercent != null) {
          prompt += `• Day Change: ${marketData.changePercent >= 0 ? '+' : ''}${marketData.changePercent.toFixed(2)}%\n`;
        }
        if (marketData.fiftyTwoWeekHigh && marketData.fiftyTwoWeekLow) {
          prompt += `• 52-Week Range: $${marketData.fiftyTwoWeekLow.toFixed(2)} – $${marketData.fiftyTwoWeekHigh.toFixed(2)}\n`;
        }
        if (marketData.volume) {
          prompt += `• Volume: ${(marketData.volume / 1e6).toFixed(1)}M\n`;
        }
        prompt += `\n`;
      }

      // ── Comprehensive Financial Metrics ──
      if (metrics?.metrics) {
        const m = metrics.metrics;
        prompt += `COMPREHENSIVE FINANCIAL DATA:\n\n`;

        // Helper to format annual data
        const formatAnnual = (arr: any[], label: string, divisor = 1, suffix = '', isPercent = false) => {
          if (!arr || arr.length === 0) return '';
          let line = `  ${label}: `;
          line += arr.slice(0, 5).map((item: any) => {
            const val = isPercent ? (item.value * 100).toFixed(1) + '%' : 
                        divisor > 1 ? '$' + (item.value / divisor).toFixed(2) + suffix : 
                        item.value.toFixed(2) + suffix;
            return `${item.period}: ${val}`;
          }).join(' | ');
          return line + '\n';
        };

        // Revenue
        prompt += `── Revenue & Growth ──\n`;
        if (m.revenue?.ttm) prompt += `  Revenue (TTM): $${(m.revenue.ttm / 1e9).toFixed(2)}B\n`;
        if (m.revenue?.cagr) prompt += `  Revenue CAGR: ${(m.revenue.cagr * 100).toFixed(1)}%\n`;
        prompt += formatAnnual(m.revenue?.annual, 'Annual Revenue', 1e9, 'B');
        prompt += formatAnnual(m.revenue?.yoyGrowth, 'YoY Growth', 1, '', true);

        // Profitability
        prompt += `\n── Profitability ──\n`;
        if (m.profitability?.grossMargin?.ttm) prompt += `  Gross Margin (TTM): ${(m.profitability.grossMargin.ttm * 100).toFixed(1)}%\n`;
        prompt += formatAnnual(m.profitability?.grossMargin?.annual, 'Gross Margin (Annual)', 1, '', true);
        if (m.profitability?.operatingMargin?.ttm) prompt += `  Operating Margin (TTM): ${(m.profitability.operatingMargin.ttm * 100).toFixed(1)}%\n`;
        prompt += formatAnnual(m.profitability?.operatingMargin?.annual, 'Operating Margin (Annual)', 1, '', true);
        if (m.profitability?.operatingIncome?.ttm) prompt += `  Operating Income (TTM): $${(m.profitability.operatingIncome.ttm / 1e9).toFixed(2)}B\n`;
        prompt += formatAnnual(m.profitability?.operatingIncome?.annual, 'Operating Income (Annual)', 1e9, 'B');
        if (m.profitability?.ebitda?.ttm) prompt += `  EBITDA (TTM): $${(m.profitability.ebitda.ttm / 1e9).toFixed(2)}B\n`;
        prompt += formatAnnual(m.profitability?.ebitdaMargin?.annual, 'EBITDA Margin (Annual)', 1, '', true);
        if (m.profitability?.netIncome?.ttm) prompt += `  Net Income (TTM): $${(m.profitability.netIncome.ttm / 1e9).toFixed(2)}B\n`;
        if (m.profitability?.netMargin?.ttm) prompt += `  Net Margin (TTM): ${(m.profitability.netMargin.ttm * 100).toFixed(1)}%\n`;
        prompt += formatAnnual(m.profitability?.netIncome?.annual, 'Net Income (Annual)', 1e9, 'B');
        prompt += formatAnnual(m.profitability?.netIncome?.yoyGrowth, 'Net Income YoY Growth', 1, '', true);

        // Cash Flow
        prompt += `\n── Cash Flow ──\n`;
        if (m.cashFlow?.operatingCashFlow?.ttm) prompt += `  Operating Cash Flow (TTM): $${(m.cashFlow.operatingCashFlow.ttm / 1e9).toFixed(2)}B\n`;
        prompt += formatAnnual(m.cashFlow?.operatingCashFlow?.annual, 'OCF (Annual)', 1e9, 'B');
        if (m.cashFlow?.freeCashFlow?.ttm) prompt += `  Free Cash Flow (TTM): $${(m.cashFlow.freeCashFlow.ttm / 1e9).toFixed(2)}B\n`;
        prompt += formatAnnual(m.cashFlow?.freeCashFlow?.annual, 'FCF (Annual)', 1e9, 'B');
        if (m.cashFlow?.capex?.ttm) prompt += `  CapEx (TTM): $${(m.cashFlow.capex.ttm / 1e9).toFixed(2)}B\n`;
        if (m.cashFlow?.capexPctRevenue?.ttm) prompt += `  CapEx % Revenue: ${(m.cashFlow.capexPctRevenue.ttm * 100).toFixed(1)}%\n`;
        if (m.cashFlow?.cashConversionRatio?.ttm) prompt += `  Cash Conversion Ratio: ${(m.cashFlow.cashConversionRatio.ttm * 100).toFixed(1)}%\n`;

        // Working Capital
        if (m.workingCapital?.dso?.length > 0 || m.workingCapital?.dio?.length > 0) {
          prompt += `\n── Working Capital Efficiency ──\n`;
          prompt += formatAnnual(m.workingCapital?.dso, 'Days Sales Outstanding');
          prompt += formatAnnual(m.workingCapital?.dio, 'Days Inventory Outstanding');
          prompt += formatAnnual(m.workingCapital?.dpo, 'Days Payable Outstanding');
          prompt += formatAnnual(m.workingCapital?.cashConversionCycle, 'Cash Conversion Cycle');
        }

        // Balance Sheet
        if (m.balanceSheet?.currentRatio?.length > 0 || m.balanceSheet?.debtToEquity?.length > 0) {
          prompt += `\n── Balance Sheet Health ──\n`;
          prompt += formatAnnual(m.balanceSheet?.currentRatio, 'Current Ratio');
          prompt += formatAnnual(m.balanceSheet?.quickRatio, 'Quick Ratio');
          prompt += formatAnnual(m.balanceSheet?.debtToEquity, 'Debt/Equity');
          prompt += formatAnnual(m.balanceSheet?.roe, 'Return on Equity', 1, '', true);
          prompt += formatAnnual(m.balanceSheet?.assetTurnover, 'Asset Turnover');
        }

        prompt += `\n`;
      } else if (metrics) {
        // Fallback: dump whatever metrics object we got
        prompt += `FINANCIAL METRICS (Summary):\n${JSON.stringify(metrics, null, 2).substring(0, 2000)}\n\n`;
      }

      // ── Narrative Context from SEC Filings ──
      if (narrativeContext && narrativeContext.length > 0) {
        prompt += `SEC FILING NARRATIVE CONTEXT (${narrativeContext.length} excerpts from 10-K/10-Q filings):\n\n`;

        // Group by section type for better organization
        const grouped: Record<string, any[]> = {};
        for (const chunk of narrativeContext) {
          const section = chunk.sectionType || 'general';
          if (!grouped[section]) grouped[section] = [];
          grouped[section].push(chunk);
        }

        for (const [section, chunks] of Object.entries(grouped)) {
          const sectionLabel = section.replace(/_/g, ' ').toUpperCase();
          prompt += `── ${sectionLabel} ──\n`;
          for (const chunk of chunks.slice(0, 5)) {
            const content = chunk.content || chunk.text || '';
            // Include more content per chunk for richer context
            prompt += `${content.substring(0, 800)}\n\n`;
          }
        }
        prompt += `\n`;
      }

      // ── Analyst Notes & Thesis (THE CORE) ──
      if (userContent) {
        prompt += `═══════════════════════════════════════\n`;
        prompt += `ANALYST'S SCRATCHPAD NOTES & INVESTMENT THESIS\n`;
        prompt += `(This is the analyst's own research, observations, and thesis — treat this as the PRIMARY input for the memo)\n`;
        prompt += `═══════════════════════════════════════\n`;
        prompt += `${userContent}\n\n`;
      }

      // ── Fund Criteria ──
      if (fundCriteria) {
        prompt += `FUND INVESTMENT CRITERIA:\n`;
        if (fundCriteria.mandate) prompt += `• Investment Mandate: ${fundCriteria.mandate}\n`;
        if (fundCriteria.checks) prompt += `• Due Diligence Checks: ${fundCriteria.checks}\n`;
        if (fundCriteria.risks) prompt += `• Risk Parameters: ${fundCriteria.risks}\n`;
        prompt += `\n`;
      }

      // ── Document Requirements ──
      prompt += `═══════════════════════════════════════\n`;
      prompt += `MEMO REQUIREMENTS:\n`;
      prompt += `═══════════════════════════════════════\n`;
      prompt += `Structure: ${this.getStructureInstructions(structure)}\n`;
      prompt += `Voice & Tone: ${this.getVoiceToneInstructions(voiceTone)}\n`;
      prompt += `Length: Comprehensive (3,000–5,000 words)\n\n`;

      prompt += `Generate a professional Investment Committee memorandum with the following sections:\n`;
      prompt += `1. EXECUTIVE SUMMARY — Concise investment thesis, key metrics, and recommendation\n`;
      prompt += `2. COMPANY OVERVIEW — Business model, competitive positioning, market opportunity\n`;
      prompt += `3. FINANCIAL ANALYSIS — Deep dive into revenue trends, profitability trajectory, cash flow generation, balance sheet strength. Use the multi-year data provided to identify trends and inflection points.\n`;
      prompt += `4. GROWTH DRIVERS & CATALYSTS — What drives future value creation\n`;
      prompt += `5. RISK ASSESSMENT — Key risks with probability/impact framework\n`;
      prompt += `6. VALUATION CONSIDERATIONS — How current valuation compares to fundamentals and growth\n`;
      prompt += `7. INVESTMENT RECOMMENDATION — Clear buy/hold/pass with conviction level and price target rationale\n\n`;

      prompt += `CRITICAL INSTRUCTIONS:\n`;
      prompt += `• Integrate the analyst's scratchpad notes as the foundation of the thesis\n`;
      prompt += `• Reference specific financial data points (exact numbers, growth rates, margins) throughout\n`;
      prompt += `• Include markdown tables for financial comparisons where appropriate\n`;
      prompt += `• Use proper markdown formatting: ## headers, **bold** for emphasis, bullet points\n`;
      prompt += `• Be specific and data-driven — avoid generic statements\n`;
      prompt += `• If SEC filing narratives mention management commentary, weave it into the analysis\n`;

      return prompt;
    }

  /**
   * Build analysis prompt for memo review
   */
  private buildAnalysisPrompt(request: MemoAnalysisRequest): string {
    let prompt = `You are a senior compliance officer and risk analyst reviewing an investment memorandum. Analyze the following content for risks, inaccuracies, and compliance with fund mandates.\n\n`;

    prompt += `FUND CRITERIA TO CHECK AGAINST:\n`;
    if (request.fundCriteria.mandate) {
      prompt += `Investment Mandate: ${request.fundCriteria.mandate}\n`;
    }
    if (request.fundCriteria.checks) {
      prompt += `Required Checks: ${request.fundCriteria.checks}\n`;
    }
    if (request.fundCriteria.risks) {
      prompt += `Risk Criteria: ${request.fundCriteria.risks}\n`;
    }

    prompt += `\nINVESTMENT MEMO CONTENT:\n${request.content}\n\n`;

    prompt += `Please provide a detailed analysis covering:\n`;
    prompt += `1. COMPLIANCE ASSESSMENT: Does the investment align with fund mandates?\n`;
    prompt += `2. RISK ANALYSIS: What are the key risks not adequately addressed?\n`;
    prompt += `3. ACCURACY CHECK: Are there any questionable claims or missing data?\n`;
    prompt += `4. RECOMMENDATIONS: What improvements or additional analysis is needed?\n`;
    prompt += `5. RISK SCORE: Rate overall risk from 1-10 (1=low risk, 10=high risk)\n\n`;

    prompt += `Format your response with clear sections and actionable recommendations.`;

    return prompt;
  }

  /**
   * Generate content using Claude Opus (best LLM for writing)
   */
  private async generateWithClaudeOpus(prompt: string, type: string): Promise<{
      content: string;
      usage?: any;
    }> {
      try {
        // Call Claude directly via Bedrock — NOT through the RAG pipeline
        const systemPrompt = type === 'investment_memo'
          ? `You are a senior equity research analyst at a top-tier institutional investment fund (e.g., Tiger Global, Coatue, Third Point). You write investment memoranda that are presented to the Investment Committee for capital allocation decisions.

  Your memos are known for:
  - Rigorous financial analysis with specific data points and trend identification
  - Clear, structured argumentation that builds a compelling investment case
  - Honest risk assessment that doesn't shy away from bear-case scenarios
  - Actionable recommendations with clear conviction levels
  - Professional markdown formatting with tables, headers, and organized sections
  - Integration of both quantitative metrics and qualitative management/business insights

  Write in a confident, analytical tone. Every claim must be supported by data. Use markdown formatting extensively — tables for financial comparisons, headers for sections, bold for key figures.`
          : 'You are a senior investment analyst at a top-tier institutional fund. Write comprehensive, professional documents with precise financial analysis, clear structure, and actionable recommendations. Use markdown formatting with headers, tables, and bullet points.';

        const content = await this.bedrockService.invokeClaude({
          prompt,
          systemPrompt,
          modelId: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
          max_tokens: 16000,
          temperature: 0.3,
        });

        return {
          content,
        };
      } catch (error) {
        this.logger.error(`Claude generation failed: ${error.message}`);
        throw error;
      }
    }

  /**
   * Build slide structure for presentations
   */
  private buildSlideStructure(presentationType: string, slideCount: number, includeCharts: any): any[] {
    const structures = {
      investment_committee: [
        { title: 'Executive Summary', type: 'summary' },
        { title: 'Investment Thesis', type: 'thesis' },
        { title: 'Company Overview', type: 'company' },
        { title: 'Financial Highlights', type: 'financials' },
        { title: 'Market Position', type: 'market' },
        { title: 'Competitive Analysis', type: 'competition' },
        { title: 'Growth Drivers', type: 'growth' },
        { title: 'Risk Assessment', type: 'risks' },
        { title: 'Valuation', type: 'valuation' },
        { title: 'Recommendation', type: 'recommendation' }
      ],
      board_presentation: [
        { title: 'Investment Overview', type: 'overview' },
        { title: 'Strategic Rationale', type: 'strategy' },
        { title: 'Financial Performance', type: 'performance' },
        { title: 'Market Opportunity', type: 'opportunity' },
        { title: 'Risk & Mitigation', type: 'risk_mitigation' },
        { title: 'Expected Returns', type: 'returns' },
        { title: 'Next Steps', type: 'next_steps' }
      ]
    };

    let baseStructure = structures[presentationType] || structures.investment_committee;
    
    // Adjust for slide count
    if (slideCount < baseStructure.length) {
      baseStructure = baseStructure.slice(0, slideCount);
    }

    return baseStructure;
  }

  /**
   * Generate content for individual slide
   */
  private async generateSlideContent(params: {
    template: any;
    deal: any;
    metrics: any;
    competitors: any[];
    userContent: string;
  }): Promise<any> {
    const { template, deal, metrics, userContent } = params;

    // Build slide-specific prompt
    let slidePrompt = `Create content for a PowerPoint slide with the following specifications:\n\n`;
    slidePrompt += `Slide Title: ${template.title}\n`;
    slidePrompt += `Slide Type: ${template.type}\n`;
    slidePrompt += `Company: ${deal.companyName} (${deal.ticker})\n\n`;

    // Add relevant data based on slide type
    if (template.type === 'financials' && metrics) {
      slidePrompt += `Financial Data:\n`;
      slidePrompt += `Revenue: ${metrics.revenue?.ttm || 'N/A'}\n`;
      slidePrompt += `Gross Margin: ${metrics.profitability?.grossMargin?.ttm || 'N/A'}\n`;
      slidePrompt += `Free Cash Flow: ${metrics.cashFlow?.freeCashFlow?.ttm || 'N/A'}\n\n`;
    }

    slidePrompt += `User Content: ${userContent}\n\n`;
    slidePrompt += `Generate bullet points and key messages for this slide. Keep it concise and impactful.`;

    const content = await this.generateWithClaudeOpus(slidePrompt, 'slide_content');

    return {
      title: template.title,
      type: template.type,
      content: content.content,
      bullets: this.extractBulletPoints(content.content)
    };
  }

  /**
   * Get structure instructions
   */
  private getStructureInstructions(structure?: string): string {
    const structures = {
      standard: 'Standard investment memo with Executive Summary, Company Overview, Financial Analysis, Investment Thesis, Risks, and Recommendation',
      detailed: 'Comprehensive analysis with detailed financial modeling, competitive landscape, and scenario analysis',
      executive: 'Concise executive summary format focusing on key investment highlights and recommendation',
      custom: 'Custom structure as specified by user'
    };

    return structures[structure as keyof typeof structures] || structures.standard;
  }

  /**
   * Get voice and tone instructions
   */
  private getVoiceToneInstructions(voiceTone?: string): string {
    const tones = {
      professional: 'Professional, objective, and formal tone suitable for institutional investors',
      analytical: 'Data-driven, quantitative focus with detailed analysis and metrics',
      persuasive: 'Compelling and confident tone that builds a strong investment case',
      conservative: 'Cautious and risk-aware tone emphasizing downside protection'
    };

    return tones[voiceTone as keyof typeof tones] || tones.professional;
  }

  /**
   * Parse analysis results from LLM response
   */
  private parseAnalysisResults(analysisContent: string): {
    analysis: string;
    riskScore: number;
    complianceIssues: string[];
    recommendations: string[];
  } {
    // Extract risk score
    const riskScoreMatch = analysisContent.match(/risk score[:\s]*(\d+)/i);
    const riskScore = riskScoreMatch ? parseInt(riskScoreMatch[1]) : 5;

    // Extract compliance issues (look for bullet points or numbered lists)
    const complianceIssues = this.extractListItems(analysisContent, 'compliance');

    // Extract recommendations
    const recommendations = this.extractListItems(analysisContent, 'recommendation');

    return {
      analysis: analysisContent,
      riskScore,
      complianceIssues,
      recommendations
    };
  }

  /**
   * Extract list items from text
   */
  private extractListItems(text: string, section: string): string[] {
    const items: string[] = [];
    const lines = text.split('\n');
    let inSection = false;

    for (const line of lines) {
      if (line.toLowerCase().includes(section.toLowerCase())) {
        inSection = true;
        continue;
      }

      if (inSection) {
        if (line.match(/^\d+\.|\-|\•/)) {
          items.push(line.replace(/^\d+\.|\-|\•/, '').trim());
        } else if (line.trim() === '' || line.match(/^\d+\./)) {
          if (items.length > 0) break;
        }
      }
    }

    return items;
  }

  /**
   * Extract bullet points from content
   */
  private extractBulletPoints(content: string): string[] {
    const bullets: string[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
      if (line.match(/^\-|\•|^\d+\./)) {
        bullets.push(line.replace(/^\-|\•|^\d+\./, '').trim());
      }
    }

    return bullets;
  }

  /**
   * Get metrics for memo generation
   */
  private async getMetricsForMemo(ticker: string): Promise<any> {
    try {
      return await this.financialCalculatorService.getMetricsSummary(ticker);
    } catch (error) {
      this.logger.warn(`Failed to get metrics for memo: ${error.message}`);
      return null;
    }
  }

  /**
   * Get market data for memo
   */
  private async getMarketDataForMemo(ticker: string): Promise<any> {
      try {
        const quote = await this.marketDataService.getStockQuote(ticker);
        if (!quote) {
          this.logger.warn(`No market data available for ${ticker}`);
          return null;
        }

        const formatMarketCap = (cap?: number) => {
          if (!cap) return 'N/A';
          if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
          if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`;
          if (cap >= 1e6) return `$${(cap / 1e6).toFixed(0)}M`;
          return `$${cap.toLocaleString()}`;
        };

        return {
          price: quote.price,
          marketCapFormatted: formatMarketCap(quote.marketCap),
          marketCap: quote.marketCap,
          change: quote.change,
          changePercent: quote.changePercent,
          previousClose: quote.previousClose,
          dayHigh: quote.dayHigh,
          dayLow: quote.dayLow,
          fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: quote.fiftyTwoWeekLow,
          volume: quote.volume,
        };
      } catch (error) {
        this.logger.warn(`Failed to get market data for memo: ${error.message}`);
        return null;
      }
    }

  /**
   * Get narrative context for memo
   */
  private async getNarrativeContextForMemo(ticker: string): Promise<any[]> {
      try {
        // Pull narrative chunks directly from the database — NOT through the RAG pipeline
        // Get key sections: business overview, risk factors, MD&A
        const sectionTypes = ['mda', 'business', 'risk_factors', 'financial_overview'];
        const allNarratives: any[] = [];

        for (const sectionType of sectionTypes) {
          const chunks = await this.semanticRetrieverService.getNarrativesForTicker(
            ticker,
            sectionType,
            5, // top 5 chunks per section
          );
          allNarratives.push(...chunks);
        }

        // If no section-typed chunks, get general narratives
        if (allNarratives.length === 0) {
          const generalChunks = await this.semanticRetrieverService.getNarrativesForTicker(
            ticker,
            undefined,
            20,
          );
          allNarratives.push(...generalChunks);
        }

        this.logger.log(`Retrieved ${allNarratives.length} narrative chunks for ${ticker} memo`);
        return allNarratives;
      } catch (error) {
        this.logger.warn(`Failed to get narrative context: ${error.message}`);
        return [];
      }
    }

  /**
   * Save generated document
   */
  private async saveGeneratedDocument(params: {
    ticker: string;
    dealId?: string | null;
    type: string;
    content: string;
    metadata: any;
  }): Promise<string> {
    const documentId = `doc_${Date.now()}`;

    // If dealId is provided, use it; otherwise use NULL (we'll store ticker in metadata)
    const dealIdValue = params.dealId || null;

    if (dealIdValue) {
      // If we have a dealId, insert with it
      await this.prisma.$executeRaw`
        INSERT INTO generated_documents (id, deal_id, document_type, content, metadata, created_at)
        VALUES (${documentId}, ${dealIdValue}::uuid, ${params.type}, ${params.content}, ${JSON.stringify(params.metadata)}::jsonb, NOW())
      `;
    } else {
      // If no dealId, we need to create a placeholder deal or store without deal_id
      // For now, let's create a minimal deal record for this ticker
      const tempDealId = await this.getOrCreateDealForTicker(params.ticker);
      
      await this.prisma.$executeRaw`
        INSERT INTO generated_documents (id, deal_id, document_type, content, metadata, created_at)
        VALUES (${documentId}, ${tempDealId}::uuid, ${params.type}, ${params.content}, ${JSON.stringify(params.metadata)}::jsonb, NOW())
      `;
    }

    return documentId;
  }

  /**
   * Get or create a deal record for a ticker (for document storage)
   */
  private async getOrCreateDealForTicker(ticker: string): Promise<string> {
    // Try to find an existing deal for this ticker
    const existingDeal = await this.prisma.deal.findFirst({
      where: { ticker },
      select: { id: true }
    });

    if (existingDeal) {
      return existingDeal.id;
    }

    // Create a minimal deal record for document storage
    // Note: This requires a tenantId - we'll use a default system tenant
    const systemTenantId = await this.getSystemTenantId();
    
    const newDeal = await this.prisma.deal.create({
      data: {
        name: `${ticker} Analysis`,
        ticker: ticker,
        dealType: 'analysis',
        status: 'draft',
        tenantId: systemTenantId,
      },
      select: { id: true }
    });

    return newDeal.id;
  }

  /**
   * Get system tenant ID (or create if doesn't exist)
   */
  private async getSystemTenantId(): Promise<string> {
    const systemTenant = await this.prisma.tenant.findFirst({
      where: { slug: 'system' },
      select: { id: true }
    });

    if (systemTenant) {
      return systemTenant.id;
    }

    // Create system tenant if it doesn't exist
    const newTenant = await this.prisma.tenant.create({
      data: {
        name: 'System',
        slug: 'system',
        tier: 'enterprise',
        status: 'active',
      },
      select: { id: true }
    });

    return newTenant.id;
  }
}