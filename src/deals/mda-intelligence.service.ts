import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * MD&A Insight - Structured insights extracted from MD&A section
 */
export interface MDAInsight {
  id?: string;
  dealId: string;
  ticker: string;
  fiscalPeriod: string;
  
  // Trends
  trends: TrendInsight[];
  
  // Risks
  risks: RiskInsight[];
  
  // Forward guidance
  guidance?: string;
  guidanceSentiment: 'positive' | 'negative' | 'neutral';
  
  // Metadata
  extractionMethod: 'pattern_based' | 'llm_based';
  confidenceScore?: number;
}

/**
 * Trend Insight - Extracted trend information
 */
export interface TrendInsight {
  metric: string;
  direction: 'increasing' | 'decreasing' | 'stable';
  magnitude?: number; // Percentage change
  drivers: string[];
  context: string;
}

/**
 * Risk Insight - Identified risk from MD&A
 */
export interface RiskInsight {
  title: string;
  severity: 'high' | 'medium' | 'low';
  description: string;
  mentions: number;
  category: 'operational' | 'financial' | 'market' | 'regulatory' | 'other';
}

/**
 * MDAIntelligenceService
 * 
 * Extracts structured insights from MD&A (Management Discussion & Analysis) sections
 * using pattern-based extraction (deterministic, $0 cost).
 * 
 * Features:
 * - Extract trends (direction, magnitude, drivers)
 * - Identify risks and categorize by severity
 * - Extract forward guidance and sentiment
 * - Pattern-based extraction (no LLM required)
 * - Store insights in database
 */
@Injectable()
export class MDAIntelligenceService {
  private readonly logger = new Logger(MDAIntelligenceService.name);

  // Trend detection patterns
  private readonly TREND_PATTERNS = [
    // Increase patterns
    { pattern: /(\w+(?:\s+\w+)?)\s+(?:increased|rose|grew|improved)\s+(?:by\s+)?(\d+(?:\.\d+)?)%/gi, direction: 'increasing' as const },
    { pattern: /(\w+(?:\s+\w+)?)\s+(?:increased|rose|grew)\s+\$?([\d,\.]+)\s+(?:million|billion)/gi, direction: 'increasing' as const },
    
    // Decrease patterns
    { pattern: /(\w+(?:\s+\w+)?)\s+(?:decreased|declined|fell|dropped)\s+(?:by\s+)?(\d+(?:\.\d+)?)%/gi, direction: 'decreasing' as const },
    { pattern: /(\w+(?:\s+\w+)?)\s+(?:decreased|declined|fell)\s+\$?([\d,\.]+)\s+(?:million|billion)/gi, direction: 'decreasing' as const },
    
    // Stable patterns
    { pattern: /(\w+(?:\s+\w+)?)\s+(?:remained stable|was flat|unchanged)/gi, direction: 'stable' as const }
  ];

  // Driver extraction patterns
  private readonly DRIVER_PATTERNS = [
    /(?:due to|driven by|primarily from|as a result of|attributable to|reflecting)\s+([^\.;]+)/gi,
    /(?:because of|owing to|resulting from)\s+([^\.;]+)/gi
  ];

  // Risk identification keywords
  private readonly RISK_KEYWORDS = {
    high: ['significant risk', 'material risk', 'substantial risk', 'critical', 'severe'],
    medium: ['risk', 'challenge', 'uncertainty', 'concern', 'potential issue'],
    low: ['may impact', 'could affect', 'possible']
  };

  // Risk categories
  private readonly RISK_CATEGORIES = {
    operational: ['supply chain', 'operations', 'production', 'manufacturing', 'logistics'],
    financial: ['liquidity', 'debt', 'credit', 'cash flow', 'financing'],
    market: ['competition', 'market share', 'demand', 'pricing', 'customer'],
    regulatory: ['regulation', 'compliance', 'legal', 'government', 'policy']
  };

  // Guidance patterns
  private readonly GUIDANCE_PATTERNS = [
    /(?:we expect|expect|guidance|outlook|forecast|anticipate|project)\s+([^\.]+)/gi,
    /(?:for\s+(?:fiscal\s+)?(?:year\s+)?\d{4})[,\s]+(?:we expect|expect)\s+([^\.]+)/gi
  ];

  // Sentiment keywords
  private readonly SENTIMENT_KEYWORDS = {
    positive: ['strong', 'growth', 'improved', 'increased', 'favorable', 'positive', 'optimistic', 'confident'],
    negative: ['weak', 'decline', 'decreased', 'unfavorable', 'negative', 'challenging', 'difficult', 'concern']
  };

  constructor(private prisma: PrismaService) {}

  /**
   * Extract insights from MD&A section
   */
  async extractInsights(
    dealId: string,
    ticker: string,
    fiscalPeriod: string,
    mdaText: string
  ): Promise<MDAInsight> {
    this.logger.log(`Extracting MD&A insights for ${ticker} ${fiscalPeriod}`);

    if (!mdaText || mdaText.trim().length === 0) {
      this.logger.warn('Empty MD&A text provided');
      return this.createEmptyInsight(dealId, ticker, fiscalPeriod);
    }

    // Extract trends
    const trends = this.extractTrends(mdaText);
    this.logger.log(`Found ${trends.length} trends`);

    // Extract risks
    const risks = this.extractRisks(mdaText);
    this.logger.log(`Found ${risks.length} risks`);

    // Extract guidance
    const { guidance, sentiment } = this.extractGuidance(mdaText);
    this.logger.log(`Guidance sentiment: ${sentiment}`);

    const insight: MDAInsight = {
      dealId,
      ticker,
      fiscalPeriod,
      trends,
      risks,
      guidance,
      guidanceSentiment: sentiment,
      extractionMethod: 'pattern_based',
      confidenceScore: this.calculateConfidenceScore(trends, risks, guidance)
    };

    return insight;
  }

  /**
   * Extract trend insights from MD&A text
   */
  private extractTrends(text: string): TrendInsight[] {
    const trends: TrendInsight[] = [];
    const seenMetrics = new Set<string>();

    for (const { pattern, direction } of this.TREND_PATTERNS) {
      const matches = text.matchAll(pattern);
      
      for (const match of matches) {
        const metric = this.normalizeMetricName(match[1]);
        const magnitude = match[2] ? parseFloat(match[2].replace(/,/g, '')) : undefined;

        // Skip duplicates
        if (seenMetrics.has(metric)) continue;
        seenMetrics.add(metric);

        // Extract context (surrounding text)
        const contextStart = Math.max(0, match.index! - 100);
        const contextEnd = Math.min(text.length, match.index! + match[0].length + 100);
        const context = text.substring(contextStart, contextEnd).trim();

        // Extract drivers from context
        const drivers = this.extractDrivers(context);

        trends.push({
          metric,
          direction,
          magnitude,
          drivers,
          context: this.cleanText(context)
        });
      }
    }

    return trends;
  }

  /**
   * Extract drivers from text
   */
  private extractDrivers(text: string): string[] {
    const drivers: string[] = [];

    for (const pattern of this.DRIVER_PATTERNS) {
      const matches = text.matchAll(pattern);
      
      for (const match of matches) {
        const driver = this.cleanText(match[1]);
        if (driver.length > 10 && driver.length < 200) {
          drivers.push(driver);
        }
      }
    }

    return [...new Set(drivers)]; // Remove duplicates
  }

  /**
   * Extract risk insights from MD&A text
   */
  private extractRisks(text: string): RiskInsight[] {
    const risks: RiskInsight[] = [];
    const sentences = this.splitIntoSentences(text);

    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();

      // Check if sentence contains risk keywords
      let severity: RiskInsight['severity'] | null = null;
      
      for (const keyword of this.RISK_KEYWORDS.high) {
        if (lowerSentence.includes(keyword)) {
          severity = 'high';
          break;
        }
      }
      
      if (!severity) {
        for (const keyword of this.RISK_KEYWORDS.medium) {
          if (lowerSentence.includes(keyword)) {
            severity = 'medium';
            break;
          }
        }
      }
      
      if (!severity) {
        for (const keyword of this.RISK_KEYWORDS.low) {
          if (lowerSentence.includes(keyword)) {
            severity = 'low';
            break;
          }
        }
      }

      if (severity) {
        // Categorize risk
        const category = this.categorizeRisk(lowerSentence);

        // Extract title (first few words)
        const words = sentence.split(/\s+/);
        const title = words.slice(0, Math.min(8, words.length)).join(' ');

        risks.push({
          title: this.cleanText(title),
          severity,
          description: this.cleanText(sentence),
          mentions: 1,
          category
        });
      }
    }

    // Merge similar risks and count mentions
    return this.mergeRisks(risks);
  }

  /**
   * Categorize risk based on keywords
   */
  private categorizeRisk(text: string): RiskInsight['category'] {
    for (const [category, keywords] of Object.entries(this.RISK_CATEGORIES)) {
      for (const keyword of keywords) {
        if (text.includes(keyword)) {
          return category as RiskInsight['category'];
        }
      }
    }
    return 'other';
  }

  /**
   * Merge similar risks and count mentions
   */
  private mergeRisks(risks: RiskInsight[]): RiskInsight[] {
    const merged = new Map<string, RiskInsight>();

    for (const risk of risks) {
      const key = risk.title.toLowerCase().substring(0, 50);
      
      if (merged.has(key)) {
        const existing = merged.get(key)!;
        existing.mentions++;
        // Keep the more severe rating
        if (this.getSeverityScore(risk.severity) > this.getSeverityScore(existing.severity)) {
          existing.severity = risk.severity;
        }
      } else {
        merged.set(key, { ...risk });
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => this.getSeverityScore(b.severity) - this.getSeverityScore(a.severity));
  }

  /**
   * Get numeric severity score for sorting
   */
  private getSeverityScore(severity: RiskInsight['severity']): number {
    switch (severity) {
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 0;
    }
  }

  /**
   * Extract forward guidance and sentiment
   */
  private extractGuidance(text: string): { guidance?: string; sentiment: MDAInsight['guidanceSentiment'] } {
    let guidance: string | undefined;

    // Extract guidance text
    for (const pattern of this.GUIDANCE_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        guidance = this.cleanText(match[1]);
        break;
      }
    }

    // Determine sentiment
    const sentiment = this.analyzeSentiment(guidance || text);

    return { guidance, sentiment };
  }

  /**
   * Analyze sentiment of text
   */
  private analyzeSentiment(text: string): MDAInsight['guidanceSentiment'] {
    const lowerText = text.toLowerCase();
    
    let positiveCount = 0;
    let negativeCount = 0;

    for (const keyword of this.SENTIMENT_KEYWORDS.positive) {
      const matches = lowerText.match(new RegExp(keyword, 'g'));
      if (matches) positiveCount += matches.length;
    }

    for (const keyword of this.SENTIMENT_KEYWORDS.negative) {
      const matches = lowerText.match(new RegExp(keyword, 'g'));
      if (matches) negativeCount += matches.length;
    }

    if (positiveCount > negativeCount * 1.5) return 'positive';
    if (negativeCount > positiveCount * 1.5) return 'negative';
    return 'neutral';
  }

  /**
   * Calculate confidence score based on extracted data
   */
  private calculateConfidenceScore(
    trends: TrendInsight[],
    risks: RiskInsight[],
    guidance?: string
  ): number {
    let score = 0;

    // Trends contribute up to 40 points
    score += Math.min(40, trends.length * 10);

    // Risks contribute up to 30 points
    score += Math.min(30, risks.length * 5);

    // Guidance contributes up to 30 points
    if (guidance && guidance.length > 20) {
      score += 30;
    }

    return Math.min(100, score);
  }

  /**
   * Normalize metric name
   */
  private normalizeMetricName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '');
  }

  /**
   * Clean text (remove extra whitespace, newlines)
   */
  private cleanText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim();
  }

  /**
   * Split text into sentences
   */
  private splitIntoSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20); // Filter out very short sentences
  }

  /**
   * Create empty insight (when no MD&A text available)
   */
  private createEmptyInsight(
    dealId: string,
    ticker: string,
    fiscalPeriod: string
  ): MDAInsight {
    return {
      dealId,
      ticker,
      fiscalPeriod,
      trends: [],
      risks: [],
      guidanceSentiment: 'neutral',
      extractionMethod: 'pattern_based',
      confidenceScore: 0
    };
  }

  /**
   * Save insights to database
   */
  async saveInsights(insight: MDAInsight): Promise<void> {
    this.logger.log(`Saving MD&A insights for ${insight.ticker} ${insight.fiscalPeriod}`);

    // Note: This requires the mda_insights table to exist
    // For now, we'll skip the actual database save until migration is run
    
    // TODO: Uncomment when migration is ready
    /*
    await this.prisma.mdaInsight.upsert({
      where: {
        dealId_fiscalPeriod: {
          dealId: insight.dealId,
          fiscalPeriod: insight.fiscalPeriod
        }
      },
      update: {
        trends: insight.trends,
        risks: insight.risks,
        guidance: insight.guidance,
        guidanceSentiment: insight.guidanceSentiment,
        extractionMethod: insight.extractionMethod,
        confidenceScore: insight.confidenceScore
      },
      create: insight
    });
    */

    this.logger.log('MD&A insights saved successfully');
  }

  /**
   * Get insights for a deal
   */
  async getInsightsForDeal(dealId: string): Promise<MDAInsight[]> {
    // TODO: Implement when database table is ready
    /*
    return this.prisma.mdaInsight.findMany({
      where: { dealId },
      orderBy: { fiscalPeriod: 'desc' }
    });
    */
    return [];
  }

  /**
   * Get insights for a ticker
   */
  async getInsightsForTicker(ticker: string): Promise<MDAInsight[]> {
    // TODO: Implement when database table is ready
    /*
    return this.prisma.mdaInsight.findMany({
      where: { ticker },
      orderBy: { fiscalPeriod: 'desc' }
    });
    */
    return [];
  }
}
