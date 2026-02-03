import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SemanticRetrieverService } from '../rag/semantic-retriever.service';
import { BedrockService } from '../rag/bedrock.service';
import { MDAIntelligenceService } from './mda-intelligence.service';
import { MetricHierarchyService } from './metric-hierarchy.service';

// Predefined qualitative questions for company analysis
const QUALITATIVE_QUESTIONS = {
  companyDescription: [
    "What exactly does {ticker} do? Describe the company's business model.",
    "What products and services does {ticker} offer?",
  ],
  revenueBreakdown: [
    "How much revenue comes from each product or revenue source for {ticker}?",
    "How much of {ticker}'s revenue is from US vs international markets?",
  ],
  growthDrivers: [
    "What are the main growth drivers for {ticker}'s business?",
    "What new products or services is {ticker} planning to launch?",
  ],
  competitiveDynamics: [
    "What industry is {ticker} in and who are the main competitors?",
    "What are {ticker}'s competitive advantages?",
  ],
  thesis: [
    "What are the potential risks for owning {ticker}?",
    "What are the potential opportunities for {ticker}?",
  ],
  industry: [
    "What is {ticker}'s total addressable market (TAM)?",
  ],
  management: [
    "Who is on {ticker}'s management team?",
  ],
};

// Priority categories to precompute (most important first)
const PRIORITY_CATEGORIES = [
  'companyDescription',
  'revenueBreakdown',
  'competitiveDynamics',
  'growthDrivers',
  'thesis',
];

export interface PrecomputeResult {
  ticker: string;
  categoriesProcessed: number;
  questionsAnswered: number;
  cached: number;
  failed: number;
  duration: number;
}

/**
 * Qualitative Pre-compute Service
 * 
 * Pre-generates and caches qualitative analysis during pipeline execution
 * so users get instant results when viewing the Qualitative Analysis tab.
 * 
 * Cache expires after 7 days or when new filings are ingested.
 */
@Injectable()
export class QualitativePrecomputeService {
  private readonly logger = new Logger(QualitativePrecomputeService.name);
  private readonly CACHE_TTL_DAYS = 7;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SemanticRetrieverService))
    private readonly semanticRetriever: SemanticRetrieverService,
    @Inject(forwardRef(() => BedrockService))
    private readonly bedrockService: BedrockService,
    private readonly mdaIntelligenceService: MDAIntelligenceService,
    private readonly metricHierarchyService: MetricHierarchyService,
  ) {}

  /**
   * Pre-compute qualitative analysis for a ticker
   * Called during pipeline Step E or as a separate step
   */
  async precomputeForTicker(ticker: string): Promise<PrecomputeResult> {
    const startTime = Date.now();
    const upperTicker = ticker.toUpperCase();
    
    this.logger.log(`🧠 Pre-computing qualitative analysis for ${upperTicker}...`);

    const result: PrecomputeResult = {
      ticker: upperTicker,
      categoriesProcessed: 0,
      questionsAnswered: 0,
      cached: 0,
      failed: 0,
      duration: 0,
    };

    try {
      // STEP 1: Extract MD&A insights for all fiscal periods
      await this.extractMDAInsightsForTicker(upperTicker);

      // STEP 2: Build metric hierarchies for all fiscal periods
      await this.buildMetricHierarchiesForTicker(upperTicker);

      // STEP 3: Check if we have valid cache for qualitative questions
      const existingCache = await this.getValidCache(upperTicker);
      if (existingCache.length > 10) {
        this.logger.log(`✅ Valid cache exists for ${upperTicker} (${existingCache.length} entries)`);
        result.cached = existingCache.length;
        result.duration = Date.now() - startTime;
        return result;
      }

      // STEP 4: Process priority categories
      for (const category of PRIORITY_CATEGORIES) {
        const questions = QUALITATIVE_QUESTIONS[category as keyof typeof QUALITATIVE_QUESTIONS];
        if (!questions) continue;

        result.categoriesProcessed++;

        for (const questionTemplate of questions) {
          const question = questionTemplate.replace(/{ticker}/g, upperTicker);
          
          try {
            // Check if already cached
            const cached = await this.getCachedAnswer(upperTicker, category, question);
            if (cached) {
              result.cached++;
              continue;
            }

            // Generate answer
            const answer = await this.generateAnswer(upperTicker, question);
            
            // Cache the result
            await this.cacheAnswer(upperTicker, category, question, answer);
            result.questionsAnswered++;
            
          } catch (error) {
            this.logger.warn(`Failed to precompute "${question}": ${error.message}`);
            result.failed++;
          }
        }
      }

      result.duration = Date.now() - startTime;
      this.logger.log(
        `✅ Qualitative precompute complete for ${upperTicker}: ` +
        `${result.questionsAnswered} generated, ${result.cached} cached, ${result.failed} failed ` +
        `(${(result.duration / 1000).toFixed(1)}s)`
      );

      return result;

    } catch (error) {
      result.duration = Date.now() - startTime;
      this.logger.error(`❌ Qualitative precompute failed for ${upperTicker}: ${error.message}`);
      return result;
    }
  }

  /**
   * Extract MD&A insights for all fiscal periods of a ticker
   * This reads from ALREADY-EXTRACTED narrative chunks (from Step A/B)
   * and performs pattern-based analysis to extract trends, risks, and guidance
   */
  private async extractMDAInsightsForTicker(ticker: string): Promise<void> {
    this.logger.log(`📊 Extracting MD&A insights for ${ticker} from existing narrative chunks...`);

    // Get all deals for this ticker
    const deals = await this.prisma.deal.findMany({
      where: { ticker },
    });

    if (deals.length === 0) {
      this.logger.warn(`No deals found for ${ticker}`);
      return;
    }

    // Get fiscal periods from financial_metrics to map filing dates
    const fiscalPeriods = await this.prisma.financialMetric.findMany({
      where: { ticker },
      select: {
        fiscalPeriod: true,
        filingDate: true
      },
      distinct: ['fiscalPeriod', 'filingDate']
    });

    // Create a map from filing date to fiscal period
    const filingDateToFiscalPeriod = new Map();
    for (const fp of fiscalPeriods) {
      if (fp.filingDate) {
        const dateKey = fp.filingDate.toISOString().split('T')[0];
        filingDateToFiscalPeriod.set(dateKey, fp.fiscalPeriod);
      }
    }

    this.logger.log(`📅 Mapped ${filingDateToFiscalPeriod.size} filing dates to fiscal periods`);

    // Get ALREADY-EXTRACTED narrative chunks (from Step A/B)
    // These were extracted during filing ingestion, we're just reading them
    const narrativeChunks = await this.prisma.narrativeChunk.findMany({
      where: {
        ticker,
        OR: [
          { sectionType: { in: ['item_7', 'item_7_01'] } }, // MD&A
          { sectionType: { in: ['item_1a'] } }, // Risk Factors
          { sectionType: { in: ['item_1', 'item_1_02'] } } // Business
        ]
      },
      select: {
        filingDate: true,
        filingType: true,
        sectionType: true,
        content: true
      }
    });

    this.logger.log(`📄 Found ${narrativeChunks.length} existing narrative chunks to analyze`);

    // Group by fiscal period
    const periodMap = new Map<string, { mda: string[]; risks: string[]; business: string[] }>();
    
    for (const chunk of narrativeChunks) {
      const dateKey = chunk.filingDate.toISOString().split('T')[0];
      const fiscalPeriod = filingDateToFiscalPeriod.get(dateKey);

      if (!fiscalPeriod) {
        // Try to derive from filing date (year)
        const year = chunk.filingDate.getFullYear();
        const derivedPeriod = `FY${year}`;
        
        if (!this.isValidFiscalPeriod(derivedPeriod)) {
          continue;
        }

        if (!periodMap.has(derivedPeriod)) {
          periodMap.set(derivedPeriod, { mda: [], risks: [], business: [] });
        }

        const sections = periodMap.get(derivedPeriod)!;
        
        if (chunk.sectionType === 'item_7' || chunk.sectionType === 'item_7_01') {
          sections.mda.push(chunk.content);
        } else if (chunk.sectionType === 'item_1a') {
          sections.risks.push(chunk.content);
        } else if (chunk.sectionType === 'item_1' || chunk.sectionType === 'item_1_02') {
          sections.business.push(chunk.content);
        }
        continue;
      }

      if (!this.isValidFiscalPeriod(fiscalPeriod)) {
        this.logger.warn(`Invalid fiscal period: ${fiscalPeriod}, skipping`);
        continue;
      }

      if (!periodMap.has(fiscalPeriod)) {
        periodMap.set(fiscalPeriod, { mda: [], risks: [], business: [] });
      }

      const sections = periodMap.get(fiscalPeriod)!;
      
      if (chunk.sectionType === 'item_7' || chunk.sectionType === 'item_7_01') {
        sections.mda.push(chunk.content);
      } else if (chunk.sectionType === 'item_1a') {
        sections.risks.push(chunk.content);
      } else if (chunk.sectionType === 'item_1' || chunk.sectionType === 'item_1_02') {
        sections.business.push(chunk.content);
      }
    }

    this.logger.log(`Found ${periodMap.size} fiscal periods to analyze`);

    // Extract insights for each period using pattern-based analysis
    for (const [fiscalPeriod, sections] of periodMap.entries()) {
      try {
        // Combine MD&A sections
        const mdaText = sections.mda.join('\n\n');
        
        if (mdaText.length < 100) {
          this.logger.warn(`Insufficient MD&A text for ${ticker} ${fiscalPeriod}, skipping`);
          continue;
        }

        // Extract insights using MDA Intelligence Service (pattern-based analysis)
        const dealId = deals[0].id; // Use first deal for this ticker
        const insight = await this.mdaIntelligenceService.extractInsights(
          dealId,
          ticker,
          fiscalPeriod,
          mdaText
        );

        // Save to database
        await this.prisma.mdaInsight.upsert({
          where: {
            dealId_fiscalPeriod: {
              dealId,
              fiscalPeriod,
            },
          },
          update: {
            trends: insight.trends as any,
            risks: insight.risks as any,
            guidance: insight.guidance,
            guidanceSentiment: insight.guidanceSentiment,
            extractionMethod: insight.extractionMethod,
            confidenceScore: insight.confidenceScore,
            updatedAt: new Date(),
          },
          create: {
            id: undefined as any, // Let DB generate
            dealId,
            ticker,
            fiscalPeriod,
            trends: insight.trends as any,
            risks: insight.risks as any,
            guidance: insight.guidance,
            guidanceSentiment: insight.guidanceSentiment,
            extractionMethod: insight.extractionMethod,
            confidenceScore: insight.confidenceScore,
          },
        });

        this.logger.log(
          `✅ Extracted insights for ${ticker} ${fiscalPeriod}: ` +
          `${insight.trends.length} trends, ${insight.risks.length} risks, ` +
          `confidence: ${insight.confidenceScore}%`
        );

      } catch (error) {
        this.logger.error(`Failed to extract insights for ${ticker} ${fiscalPeriod}: ${error.message}`);
      }
    }
  }

  /**
   * Build metric hierarchies for all fiscal periods of a ticker
   */
  private async buildMetricHierarchiesForTicker(ticker: string): Promise<void> {
    this.logger.log(`🔗 Building metric hierarchies for ${ticker}...`);

    // Get all deals for this ticker
    const deals = await this.prisma.deal.findMany({
      where: { ticker },
    });

    if (deals.length === 0) {
      return;
    }

    // Get all fiscal periods with metrics
    const fiscalPeriods = await this.prisma.financialMetric.findMany({
      where: { ticker },
      select: { fiscalPeriod: true },
      distinct: ['fiscalPeriod'],
    });

    for (const { fiscalPeriod } of fiscalPeriods) {
      if (!this.isValidFiscalPeriod(fiscalPeriod)) {
        this.logger.warn(`Invalid fiscal period: ${fiscalPeriod}, skipping hierarchy build`);
        continue;
      }

      try {
        // Get metrics for this period
        const metrics = await this.prisma.financialMetric.findMany({
          where: { ticker, fiscalPeriod },
        });

        if (metrics.length === 0) {
          continue;
        }

        // Build hierarchy
        const hierarchy = this.metricHierarchyService.buildHierarchy(metrics);

        // Save hierarchy
        const dealId = deals[0].id;
        await this.metricHierarchyService.saveHierarchy(dealId, hierarchy);

        this.logger.log(`✅ Built hierarchy for ${ticker} ${fiscalPeriod}: ${hierarchy.size} nodes`);

      } catch (error) {
        this.logger.error(`Failed to build hierarchy for ${ticker} ${fiscalPeriod}: ${error.message}`);
      }
    }
  }

  /**
   * Validate fiscal period format and range
   * Valid formats: FY2024, Q4 2024, 6M 2024, 9M 2024, 2024
   * Valid range: 1990-2030
   */
  private isValidFiscalPeriod(fiscalPeriod: string): boolean {
    if (!fiscalPeriod || fiscalPeriod.trim().length === 0) {
      return false;
    }

    // Extract year from various formats
    const fyMatch = fiscalPeriod.match(/FY(\d{4})/);
    const qMatch = fiscalPeriod.match(/Q\d\s+(\d{4})/);
    const mMatch = fiscalPeriod.match(/(\d+)M\s+(\d{4})/); // 6M 2023, 9M 2024
    const yearMatch = fiscalPeriod.match(/^(\d{4})$/);

    let year: number | null = null;

    if (fyMatch) {
      year = parseInt(fyMatch[1]);
    } else if (qMatch) {
      year = parseInt(qMatch[1]);
    } else if (mMatch) {
      year = parseInt(mMatch[2]);
    } else if (yearMatch) {
      year = parseInt(yearMatch[1]);
    }

    // Validate year range (1990-2030)
    if (year === null || year < 1990 || year > 2030) {
      return false;
    }

    return true;
  }

  /**
   * Generate answer for a question using KB + Bedrock
   */
  private async generateAnswer(ticker: string, question: string): Promise<{
    answer: string;
    sources: any[];
    confidence: string;
    narrativeCount: number;
  }> {
    // Retrieve from KB
    const { narratives, contextualMetrics, summary } = await this.semanticRetriever.retrieveWithContext({
      query: question,
      tickers: [ticker],
      numberOfResults: 5,
    });

    let answer = 'No relevant information found in SEC filings.';
    let confidence = 'low';

    if (narratives.length > 0) {
      try {
        const generated = await this.bedrockService.generate(question, {
          metrics: contextualMetrics,
          narratives: narratives,
        });
        answer = generated.answer;
        confidence = summary.avgScore > 0.6 ? 'high' : summary.avgScore > 0.4 ? 'medium' : 'low';
      } catch (genError) {
        // Fallback: Build answer from narratives
        this.logger.warn(`Bedrock generation failed, using fallback: ${genError.message}`);
        answer = this.buildAnswerFromNarratives(narratives);
        confidence = 'medium';
      }
    }

    return {
      answer,
      sources: narratives.slice(0, 3).map(n => ({
        section: n.metadata.sectionType,
        filingType: n.metadata.filingType,
        fiscalPeriod: n.metadata.fiscalPeriod,
        score: n.score,
      })),
      confidence,
      narrativeCount: narratives.length,
    };
  }

  /**
   * Build answer from narratives when Bedrock fails
   */
  private buildAnswerFromNarratives(narratives: any[]): string {
    if (narratives.length === 0) return 'No relevant information found.';

    const parts: string[] = ['Based on SEC filings:\n'];
    for (let i = 0; i < Math.min(narratives.length, 2); i++) {
      const n = narratives[i];
      const excerpt = n.content.length > 400 ? n.content.substring(0, 400) + '...' : n.content;
      parts.push(`\n[${n.metadata.filingType}] ${excerpt}`);
    }
    return parts.join('\n');
  }

  /**
   * Cache an answer
   */
  private async cacheAnswer(
    ticker: string,
    category: string,
    question: string,
    data: { answer: string; sources: any[]; confidence: string; narrativeCount: number },
  ): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.CACHE_TTL_DAYS);

    await this.prisma.$executeRaw`
      INSERT INTO qualitative_cache (id, ticker, category, question, answer, sources, confidence, narrative_count, expires_at, generated_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        ${ticker},
        ${category},
        ${question},
        ${data.answer},
        ${JSON.stringify(data.sources)}::jsonb,
        ${data.confidence},
        ${data.narrativeCount},
        ${expiresAt},
        NOW(),
        NOW(),
        NOW()
      )
      ON CONFLICT (ticker, category, question) 
      DO UPDATE SET 
        answer = ${data.answer},
        sources = ${JSON.stringify(data.sources)}::jsonb,
        confidence = ${data.confidence},
        narrative_count = ${data.narrativeCount},
        expires_at = ${expiresAt},
        generated_at = NOW(),
        updated_at = NOW()
    `;
  }

  /**
   * Get cached answer if valid
   */
  private async getCachedAnswer(ticker: string, category: string, question: string): Promise<any | null> {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT * FROM qualitative_cache 
      WHERE ticker = ${ticker} 
        AND category = ${category} 
        AND question = ${question}
        AND expires_at > NOW()
      LIMIT 1
    `;
    return result.length > 0 ? result[0] : null;
  }

  /**
   * Get all valid cached entries for a ticker
   */
  async getValidCache(ticker: string): Promise<any[]> {
    return this.prisma.$queryRaw<any[]>`
      SELECT * FROM qualitative_cache 
      WHERE ticker = ${ticker.toUpperCase()} 
        AND expires_at > NOW()
      ORDER BY category, question
    `;
  }

  /**
   * Get cached qualitative data organized by category
   */
  async getCachedQualitative(ticker: string, category?: string): Promise<Record<string, any[]>> {
    const upperTicker = ticker.toUpperCase();
    
    let query = `
      SELECT category, question, answer, sources, confidence, narrative_count, generated_at
      FROM qualitative_cache 
      WHERE ticker = $1 AND expires_at > NOW()
    `;
    const params: any[] = [upperTicker];
    
    if (category) {
      query += ` AND category = $2`;
      params.push(category);
    }
    
    query += ` ORDER BY category, question`;
    
    const results = await this.prisma.$queryRawUnsafe<any[]>(query, ...params);
    
    // Organize by category
    const organized: Record<string, any[]> = {};
    for (const row of results) {
      if (!organized[row.category]) {
        organized[row.category] = [];
      }
      organized[row.category].push({
        question: row.question,
        answer: row.answer,
        sources: row.sources,
        confidence: row.confidence,
        narrativeCount: row.narrative_count,
        generatedAt: row.generated_at,
        cached: true,
      });
    }
    
    return organized;
  }

  /**
   * Invalidate cache for a ticker (call when new filings are ingested)
   */
  async invalidateCache(ticker: string): Promise<number> {
    const result = await this.prisma.$executeRaw`
      DELETE FROM qualitative_cache WHERE ticker = ${ticker.toUpperCase()}
    `;
    this.logger.log(`Invalidated ${result} cached entries for ${ticker}`);
    return result as number;
  }

  /**
   * Check if ticker has valid precomputed data
   */
  async hasValidCache(ticker: string): Promise<boolean> {
    const count = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM qualitative_cache 
      WHERE ticker = ${ticker.toUpperCase()} AND expires_at > NOW()
    `;
    return Number(count[0].count) >= 5; // At least 5 cached answers
  }
}
