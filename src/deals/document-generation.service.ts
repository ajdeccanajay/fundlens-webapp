import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RAGService } from '../rag/rag.service';
import { FinancialCalculatorService } from './financial-calculator.service';

export interface DocumentGenerationRequest {
  dealId: string;
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
  dealId: string;
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
  ) {}

  /**
   * Generate investment memorandum
   */
  async generateInvestmentMemo(request: DocumentGenerationRequest): Promise<{
    content: string;
    downloadUrl: string;
  }> {
    this.logger.log(`Generating investment memo for deal: ${request.dealId}`);

    try {
      // Get deal context
      const deal = await this.getDealContext(request.dealId);
      
      // Get comprehensive data
      const [metrics, marketData, narrativeContext] = await Promise.all([
        this.getMetricsForMemo(deal.ticker),
        this.getMarketDataForMemo(deal.ticker),
        this.getNarrativeContextForMemo(deal.ticker)
      ]);

      // Build comprehensive prompt for LLM
      const prompt = this.buildMemoPrompt({
        deal,
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

      // Save generated document
      const documentId = await this.saveGeneratedDocument({
        dealId: request.dealId,
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
    this.logger.log(`Generating PowerPoint deck for deal: ${request.dealId}`);

    try {
      // Get deal context
      const deal = await this.getDealContext(request.dealId);

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
        dealId: request.dealId,
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
    deal: any;
    metrics: any;
    marketData: any;
    narrativeContext: any;
    userContent: string;
    fundCriteria?: any;
    structure?: string;
    voiceTone?: string;
    customSections?: string;
  }): string {
    const { deal, metrics, marketData, narrativeContext, userContent, fundCriteria, structure, voiceTone } = data;

    let prompt = `You are a senior investment analyst tasked with writing a comprehensive investment memorandum. Use the following information to create a professional, well-structured document.\n\n`;

    // Add company context
    prompt += `COMPANY INFORMATION:\n`;
    prompt += `Company: ${deal.companyName} (${deal.ticker})\n`;
    prompt += `Current Price: $${marketData?.price?.toFixed(2) || 'N/A'}\n`;
    prompt += `Market Cap: ${marketData?.marketCapFormatted || 'N/A'}\n\n`;

    // Add financial metrics
    if (metrics) {
      prompt += `FINANCIAL METRICS:\n`;
      if (metrics.revenue?.ttm) {
        prompt += `Revenue (TTM): $${(metrics.revenue.ttm / 1e9).toFixed(2)}B\n`;
      }
      if (metrics.profitability?.grossMargin?.ttm) {
        prompt += `Gross Margin: ${(metrics.profitability.grossMargin.ttm * 100).toFixed(1)}%\n`;
      }
      if (metrics.cashFlow?.freeCashFlow?.ttm) {
        prompt += `Free Cash Flow: $${(metrics.cashFlow.freeCashFlow.ttm / 1e9).toFixed(2)}B\n`;
      }
      prompt += `\n`;
    }

    // Add narrative context
    if (narrativeContext && narrativeContext.length > 0) {
      prompt += `MANAGEMENT COMMENTARY & BUSINESS CONTEXT:\n`;
      narrativeContext.slice(0, 3).forEach((narrative: any, index: number) => {
        prompt += `${index + 1}. ${narrative.content.substring(0, 300)}...\n`;
      });
      prompt += `\n`;
    }

    // Add user content
    if (userContent) {
      prompt += `ANALYST NOTES & THESIS:\n${userContent}\n\n`;
    }

    // Add fund criteria
    if (fundCriteria) {
      prompt += `FUND INVESTMENT CRITERIA:\n`;
      if (fundCriteria.mandate) prompt += `Mandate: ${fundCriteria.mandate}\n`;
      if (fundCriteria.checks) prompt += `Investment Checks: ${fundCriteria.checks}\n`;
      if (fundCriteria.risks) prompt += `Risk Criteria: ${fundCriteria.risks}\n`;
      prompt += `\n`;
    }

    // Add structure and tone instructions
    prompt += `DOCUMENT REQUIREMENTS:\n`;
    prompt += `Structure: ${this.getStructureInstructions(structure)}\n`;
    prompt += `Voice & Tone: ${this.getVoiceToneInstructions(voiceTone)}\n`;
    prompt += `Length: Comprehensive (3000-5000 words)\n\n`;

    prompt += `Please generate a professional investment memorandum that integrates all the provided information. Include executive summary, investment thesis, financial analysis, risk assessment, and recommendation. Use proper formatting with headers and bullet points.`;

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
      // Use the existing RAG service which has Bedrock integration
      const response = await this.ragService.query(prompt, {
        includeNarrative: false,
        includeCitations: false
      });

      return {
        content: response.answer,
        usage: response.usage
      };
    } catch (error) {
      this.logger.error(`Claude Opus generation failed: ${error.message}`);
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
   * Get deal context
   */
  private async getDealContext(dealId: string): Promise<any> {
    const deals = await this.prisma.$queryRaw`
      SELECT * FROM deals WHERE id = ${dealId}::uuid
    ` as any[];

    if (!deals[0]) {
      throw new Error(`Deal ${dealId} not found`);
    }

    return deals[0];
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
      // This would integrate with MarketDataService
      return {
        price: 273.67,
        marketCapFormatted: '$4.04T',
        change: 1.48,
        changePercent: 0.54
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
      const response = await this.ragService.query(`${ticker} business overview and strategy`, {
        includeNarrative: true,
        includeCitations: false
      });

      return response.narratives || [];
    } catch (error) {
      this.logger.warn(`Failed to get narrative context: ${error.message}`);
      return [];
    }
  }

  /**
   * Save generated document
   */
  private async saveGeneratedDocument(params: {
    dealId: string;
    type: string;
    content: string;
    metadata: any;
  }): Promise<string> {
    const documentId = `doc_${Date.now()}`;

    await this.prisma.$executeRaw`
      INSERT INTO generated_documents (id, deal_id, document_type, content, metadata, created_at)
      VALUES (${documentId}, ${params.dealId}::uuid, ${params.type}, ${params.content}, ${JSON.stringify(params.metadata)}::jsonb, NOW())
    `;

    return documentId;
  }
}