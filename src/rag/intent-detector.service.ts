import { Injectable, Logger } from '@nestjs/common';
import { QueryIntent, QueryType, PeriodType } from './types/query-intent';
import { BedrockService } from './bedrock.service';
import { IntentAnalyticsService } from './intent-analytics.service';

/**
 * Intent Detector Service
 * Parses natural language queries to extract structured intent
 * 
 * Uses hybrid detection:
 * 1. Regex patterns (fast, 80% accuracy)
 * 2. LLM fallback (slower, 95%+ accuracy)
 * 3. Generic fallback (always succeeds)
 */
@Injectable()
export class IntentDetectorService {
  private readonly logger = new Logger(IntentDetectorService.name);
  
  // LLM usage tracking
  private llmUsageStats = {
    totalQueries: 0,
    regexSuccess: 0,
    llmFallback: 0,
    genericFallback: 0,
    llmLatencyMs: [] as number[],
  };

  constructor(
    private readonly bedrock: BedrockService,
    private readonly analytics: IntentAnalyticsService,
  ) {}

  /**
   * Detect intent from natural language query
   * Uses three-tier fallback: regex → LLM → generic
   */
  async detectIntent(query: string, tenantId?: string): Promise<QueryIntent> {
    this.logger.log(`Detecting intent for query: "${query}"`);
    this.llmUsageStats.totalQueries++;

    const startTime = Date.now();

    // Tier 1: Try regex detection first (fast path)
    const regexIntent = await this.detectWithRegex(query);
    
    // CRITICAL FIX: Changed from > 0.7 to >= 0.7 to accept queries with exactly 0.7 confidence
    // (e.g., queries with only ticker: 0.5 base + 0.2 ticker = 0.7)
    if (regexIntent.confidence >= 0.7) {
      this.llmUsageStats.regexSuccess++;
      const latency = Date.now() - startTime;
      this.logger.log(`✅ Regex detection succeeded (confidence: ${regexIntent.confidence.toFixed(2)}, latency: ${latency}ms)`);
      
      // Log to analytics
      if (tenantId) {
        await this.analytics.logDetection({
          tenantId,
          query,
          detectedIntent: regexIntent,
          detectionMethod: 'regex',
          confidence: regexIntent.confidence,
          success: true,
          latencyMs: latency,
        });
      }
      
      this.logUsageStats();
      return regexIntent;
    }

    // Tier 2: Fallback to LLM (slower but more accurate)
    this.logger.log(`⚠️ Regex confidence low (${regexIntent.confidence.toFixed(2)}), falling back to LLM`);
    
    try {
      const llmIntent = await this.detectWithLLM(query);
      const llmLatency = Date.now() - startTime;
      this.llmUsageStats.llmLatencyMs.push(llmLatency);
      
      if (llmIntent.confidence > 0.6) {
        this.llmUsageStats.llmFallback++;
        this.logger.log(`✅ LLM detection succeeded (confidence: ${llmIntent.confidence.toFixed(2)}, latency: ${llmLatency}ms)`);
        
        // Log to analytics with LLM cost
        if (tenantId) {
          const llmCost = this.calculateLLMCost(query);
          await this.analytics.logDetection({
            tenantId,
            query,
            detectedIntent: llmIntent,
            detectionMethod: 'llm',
            confidence: llmIntent.confidence,
            success: true,
            latencyMs: llmLatency,
            llmCostUsd: llmCost,
          });
        }
        
        this.logUsageStats();
        return llmIntent;
      }

      // Tier 3: Generic fallback - PRESERVE regex-detected ticker
      this.logger.log(`⚠️ LLM confidence low (${llmIntent.confidence.toFixed(2)}), using generic detection with regex ticker`);
      this.llmUsageStats.genericFallback++;
      const genericIntent = this.detectGenericWithRegexFallback(query, regexIntent);
      
      // Log to analytics
      if (tenantId) {
        await this.analytics.logDetection({
          tenantId,
          query,
          detectedIntent: genericIntent,
          detectionMethod: 'generic',
          confidence: genericIntent.confidence,
          success: false,
          latencyMs: Date.now() - startTime,
        });
      }
      
      this.logUsageStats();
      return genericIntent;
      
    } catch (error) {
      this.logger.error(`LLM detection failed: ${error.message}`);
      this.llmUsageStats.genericFallback++;
      // CRITICAL FIX: Preserve regex-detected ticker when LLM fails
      const genericIntent = this.detectGenericWithRegexFallback(query, regexIntent);
      
      // Log to analytics
      if (tenantId) {
        await this.analytics.logDetection({
          tenantId,
          query,
          detectedIntent: genericIntent,
          detectionMethod: 'generic',
          confidence: genericIntent.confidence,
          success: false,
          errorMessage: error.message,
          latencyMs: Date.now() - startTime,
        });
      }
      
      this.logUsageStats();
      return genericIntent;
    }
  }

  /**
   * Detect intent using regex patterns (original implementation)
   */
  private async detectWithRegex(query: string): Promise<QueryIntent> {
    const normalizedQuery = query.toLowerCase();

    // Extract components
    const ticker = this.extractTicker(normalizedQuery);
    const metrics = this.extractMetrics(normalizedQuery);
    const period = this.extractPeriod(normalizedQuery);
    const periodType = this.determinePeriodType(period);
    const documentTypes = this.extractDocumentTypes(normalizedQuery);
    const sectionTypes = this.extractSectionTypes(normalizedQuery);

    // Identify target subsection (Phase 2 enhancement)
    const subsectionName = this.identifyTargetSubsection(normalizedQuery, sectionTypes);

    // Determine query type
    const type = this.determineQueryType(
      normalizedQuery,
      metrics,
      sectionTypes,
    );

    // Determine characteristics
    const needsNarrative = this.needsNarrative(normalizedQuery, type);
    const needsComparison = this.needsComparison(normalizedQuery);
    const needsComputation = this.needsComputation(normalizedQuery, metrics);
    const needsTrend = this.needsTrend(normalizedQuery);

    const intent: QueryIntent = {
      type,
      ticker,
      metrics: metrics.length > 0 ? metrics : undefined,
      period,
      periodType,
      documentTypes: documentTypes.length > 0 ? documentTypes : undefined,
      sectionTypes: sectionTypes.length > 0 ? sectionTypes : undefined,
      subsectionName,
      needsNarrative,
      needsComparison,
      needsComputation,
      needsTrend,
      confidence: this.calculateConfidence(ticker, metrics, period),
      originalQuery: query,
    };

    this.logger.log(`Detected intent: ${JSON.stringify(intent, null, 2)}`);

    return intent;
  }

  /**
   * Extract ticker symbol from query
   */
  private extractTicker(query: string): string | string[] | undefined {
    const foundTickers = new Set<string>();

    // Common ticker patterns - includes RH (Restoration Hardware)
    const tickerPatterns = [
      /\b(AAPL|MSFT|GOOGL|GOOG|AMZN|TSLA|META|NVDA|JPM|BAC|WFC|V|MA|DIS|NFLX|INTC|AMD|ORCL|CRM|ADBE|PYPL|CSCO|PFE|MRK|JNJ|UNH|CVS|WMT|TGT|HD|LOW|NKE|SBUX|MCD|KO|PEP|RH)\b/gi,
    ];

    // Try specific tickers first
    const specificMatch = query.match(tickerPatterns[0]);
    if (specificMatch) {
      specificMatch.forEach(ticker => foundTickers.add(ticker.toUpperCase()));
    }

    // Company name to ticker mapping (enhanced for comparison queries)
    const companyMap: Record<string, string> = {
      apple: 'AAPL',
      'apple inc': 'AAPL',
      microsoft: 'MSFT',
      'microsoft corp': 'MSFT',
      google: 'GOOGL',
      alphabet: 'GOOGL',
      amazon: 'AMZN',
      'amazon.com': 'AMZN',
      tesla: 'TSLA',
      'tesla inc': 'TSLA',
      meta: 'META',
      facebook: 'META',
      'meta platforms': 'META',
      nvidia: 'NVDA',
      'jp morgan': 'JPM',
      jpmorgan: 'JPM',
      'jpmorgan chase': 'JPM',
      'restoration hardware': 'RH',
      'rh inc': 'RH',
    };

    // Check for company names (case insensitive)
    const lowerQuery = query.toLowerCase();
    for (const [company, ticker] of Object.entries(companyMap)) {
      if (lowerQuery.includes(company)) {
        foundTickers.add(ticker);
      }
    }

    // Convert to array
    const tickers = Array.from(foundTickers);
    
    if (tickers.length === 0) {
      return undefined;
    } else if (tickers.length === 1) {
      return tickers[0];
    } else {
      // Multiple tickers found - return array for comparison queries
      this.logger.log(`🔍 Multiple tickers detected: ${tickers.join(', ')}`);
      return tickers;
    }
  }

  /**
   * Extract financial metrics from query
   */
  private extractMetrics(query: string): string[] {
    const metrics: string[] = [];

    // Metric patterns (using capitalized names to match database)
    const metricPatterns: Record<string, string[]> = {
      Revenue: ['revenue', 'sales', 'top line', 'topline'],
      Net_Income: ['net income', 'profit', 'earnings', 'bottom line'],
      Gross_Profit: ['gross profit'],
      Operating_Income: ['operating income', 'operating profit', 'ebit'],
      Cost_of_Revenue: ['cost of revenue', 'cost of goods sold', 'cost of sales', 'cogs'],
      Research_and_Development: ['research and development', 'r&d', 'rnd'],
      Selling_General_Administrative: ['selling general administrative', 'sg&a', 'sga', 'selling general and administrative'],
      Total_Assets: ['total assets', 'assets'],
      Total_Liabilities: ['total liabilities', 'liabilities', 'debt'],
      Total_Equity: ['total equity', 'equity', 'shareholders equity'],
      Cash_and_Cash_Equivalents: ['cash', 'cash and cash equivalents', 'cash and equivalents', 'cash equivalents'],
      Accounts_Payable: ['accounts payable', 'payables'],
      Accounts_Receivable: ['accounts receivable', 'receivables'],
      Inventory: ['inventory'],
      gross_margin: ['gross margin'],
      net_margin: ['net margin', 'profit margin'],
      operating_margin: ['operating margin'],
      roe: ['roe', 'return on equity'],
      roa: ['roa', 'return on assets'],
    };

    for (const [metric, patterns] of Object.entries(metricPatterns)) {
      for (const pattern of patterns) {
        if (query.includes(pattern)) {
          metrics.push(metric);
          break;
        }
      }
    }

    return [...new Set(metrics)];
  }

  /**
   * Extract time period from query
   */
  private extractPeriod(query: string): string | undefined {
    // Latest
    if (query.match(/\b(latest|most recent|current)\b/i)) {
      return 'latest';
    }

    // Fiscal year: FY2024, fiscal year 2024, 2024
    const fyMatch = query.match(/\b(?:fy|fiscal year)\s*(\d{4})\b/i);
    if (fyMatch) {
      return `FY${fyMatch[1]}`;
    }

    // Just year: 2024
    const yearMatch = query.match(/\b(20\d{2})\b/);
    if (yearMatch) {
      return `FY${yearMatch[1]}`;
    }

    // Quarter: Q4 2024, Q4-2024
    const quarterMatch = query.match(/\bq([1-4])[\s-]*(20\d{2})\b/i);
    if (quarterMatch) {
      return `Q${quarterMatch[1]}-${quarterMatch[2]}`;
    }

    return undefined;
  }

  /**
   * Determine period type
   */
  private determinePeriodType(period?: string): PeriodType | undefined {
    if (!period) return undefined;

    if (period === 'latest') return 'latest';
    if (period.startsWith('FY')) return 'annual';
    if (period.match(/Q\d-\d{4}/)) return 'quarterly';

    return undefined;
  }

  /**
   * Extract document types from query
   */
  private extractDocumentTypes(query: string): any[] {
    const types: any[] = [];

    if (query.match(/\b(10-k|annual report|annual filing)\b/i)) {
      types.push('10-K');
    }
    if (query.match(/\b(10-q|quarterly report|quarterly filing)\b/i)) {
      types.push('10-Q');
    }
    if (query.match(/\b(8-k|current report)\b/i)) {
      types.push('8-K');
    }
    if (query.match(/\b(news|article|press)\b/i)) {
      types.push('news');
    }
    if (query.match(/\b(earnings call|transcript|conference call)\b/i)) {
      types.push('earnings_transcript');
    }

    // Default to SEC filings if metrics mentioned
    if (types.length === 0 && this.extractMetrics(query).length > 0) {
      types.push('10-K', '10-Q');
    }

    return types;
  }

  /**
   * Extract section types from query
   * Maps user-friendly terms to actual SEC filing section identifiers
   */
  private extractSectionTypes(query: string): any[] {
    const sections: any[] = [];

    // MD&A is Item 7 in 10-K
    if (
      query.match(
        /\b(md&a|management discussion|management's discussion)\b/i,
      )
    ) {
      sections.push('item_7');
    }
    // Risk factors is Item 1A in 10-K
    if (query.match(/\b(risk|risk factors)\b/i)) {
      sections.push('item_1a');
    }
    // Business description is Item 1 in 10-K
    if (query.match(/\b(business|business model|strategy|what does.*do|describe.*company|products|services|competitor|competitors|competition)\b/i)) {
      sections.push('item_1');
    }
    // Financial statements is Item 8 in 10-K
    if (query.match(/\b(notes|footnotes|financial statements)\b/i)) {
      sections.push('item_8');
    }
    // Properties is Item 2 in 10-K
    if (query.match(/\b(properties|facilities|locations)\b/i)) {
      sections.push('item_2');
    }
    // Legal proceedings is Item 3 in 10-K
    if (query.match(/\b(legal|litigation|lawsuit|proceedings)\b/i)) {
      sections.push('item_3');
    }

    return sections;
  }

  /**
   * Determine query type
   */
  private determineQueryType(
    query: string,
    metrics: string[],
    sections: any[],
  ): QueryType {
    const hasMetrics = metrics.length > 0;
    const hasNarrativeKeywords = this.hasNarrativeKeywords(query);
    const hasSections = sections.length > 0;

    // Structured: Only asking for metrics
    if (hasMetrics && !hasNarrativeKeywords && !hasSections) {
      return 'structured';
    }

    // Semantic: Only asking for narrative/explanation
    if (!hasMetrics && (hasNarrativeKeywords || hasSections)) {
      return 'semantic';
    }

    // Hybrid: Asking for both metrics and explanation
    if (hasMetrics && (hasNarrativeKeywords || hasSections)) {
      return 'hybrid';
    }

    // Default to semantic for open-ended questions
    return 'semantic';
  }

  /**
   * Check if query needs narrative explanation
   */
  private needsNarrative(query: string, type: QueryType): boolean {
    if (type === 'semantic' || type === 'hybrid') return true;

    const narrativeKeywords = [
      'why',
      'how',
      'explain',
      'describe',
      'what caused',
      'reason',
      'impact',
      'affect',
      'strategy',
      'outlook',
    ];

    return narrativeKeywords.some((keyword) => query.includes(keyword));
  }

  /**
   * Check if query has narrative keywords
   */
  private hasNarrativeKeywords(query: string): boolean {
    const keywords = [
      'why',
      'how',
      'explain',
      'describe',
      'discuss',
      'analyze',
      'what caused',
      'reason',
      'impact',
      'affect',
      'strategy',
      'outlook',
      'trend',
      'growth',
      'decline',
      'improve',
      'worsen',
    ];

    return keywords.some((keyword) => query.includes(keyword));
  }

  /**
   * Check if query needs comparison
   */
  private needsComparison(query: string): boolean {
    const comparisonKeywords = [
      'compare',
      'versus',
      'vs',
      'difference',
      'better',
      'worse',
      'higher',
      'lower',
      'more than',
      'less than',
    ];

    return comparisonKeywords.some((keyword) => query.includes(keyword));
  }

  /**
   * Check if query needs computation
   */
  private needsComputation(query: string, metrics: string[]): boolean {
    // Check for computed metrics
    const computedMetrics = [
      'margin',
      'ratio',
      'roe',
      'roa',
      'growth',
      'change',
      'increase',
      'decrease',
    ];

    if (computedMetrics.some((m) => query.includes(m))) {
      return true;
    }

    // Check if metrics include computed ones
    const computedMetricNames = [
      'gross_margin',
      'net_margin',
      'operating_margin',
      'roe',
      'roa',
    ];

    return metrics.some((m) => computedMetricNames.includes(m));
  }

  /**
   * Check if query needs trend analysis
   */
  private needsTrend(query: string): boolean {
    const trendKeywords = [
      'trend',
      'over time',
      'historical',
      'growth',
      'change',
      'evolution',
      'trajectory',
    ];

    return trendKeywords.some((keyword) => query.includes(keyword));
  }

  /**
   * Identify target subsection within a section (Phase 2 enhancement)
   * Returns subsection name if keywords match, undefined otherwise
   */
  private identifyTargetSubsection(query: string, sectionTypes: any[]): string | undefined {
    if (!sectionTypes || sectionTypes.length === 0) {
      return undefined;
    }

    // Process each section type and find the most specific subsection
    for (const sectionType of sectionTypes) {
      const subsection = this.identifySubsectionForSection(query, sectionType);
      if (subsection) {
        return subsection;
      }
    }

    return undefined;
  }

  /**
   * Identify subsection for a specific section type
   */
  private identifySubsectionForSection(query: string, sectionType: string): string | undefined {
    switch (sectionType) {
      case 'item_1':
        return this.identifyItem1Subsection(query);
      case 'item_7':
        return this.identifyItem7Subsection(query);
      case 'item_8':
        return this.identifyItem8Subsection(query);
      case 'item_1a':
        return this.identifyItem1ASubsection(query);
      default:
        return undefined;
    }
  }

  /**
   * Identify Item 1 (Business) subsections
   */
  private identifyItem1Subsection(query: string): string | undefined {
    // Subsection patterns for Item 1 (Business)
    const subsectionPatterns: Record<string, string[]> = {
      'Competition': ['competitor', 'competitors', 'competitive landscape', 'competition', 'compete', 'competing'],
      'Products': ['product', 'products', 'product line', 'offerings', 'services'],
      'Customers': ['customer', 'customers', 'customer base', 'clientele'],
      'Markets': ['market', 'markets', 'market segment', 'market segments', 'geographic markets'],
      'Operations': ['operation', 'operations', 'business operations', 'operating model'],
      'Strategy': ['strategy', 'strategies', 'business strategy', 'strategic', 'strategic plan'],
      'Intellectual Property': ['intellectual property', 'patent', 'patents', 'trademark', 'trademarks', 'ip'],
      'Human Capital': ['employee', 'employees', 'human capital', 'workforce', 'talent', 'personnel'],
    };

    // Check patterns in order of specificity (most specific first)
    for (const [subsection, patterns] of Object.entries(subsectionPatterns)) {
      for (const pattern of patterns) {
        if (query.includes(pattern)) {
          this.logger.log(`🎯 Identified Item 1 subsection: ${subsection} (matched: "${pattern}")`);
          return subsection;
        }
      }
    }

    return undefined;
  }

  /**
   * Identify Item 7 (MD&A) subsections
   */
  private identifyItem7Subsection(query: string): string | undefined {
    // Subsection patterns for Item 7 (MD&A)
    const subsectionPatterns: Record<string, string[]> = {
      'Results of Operations': ['results of operations', 'operating results', 'performance', 'growth driver', 'growth drivers'],
      'Liquidity and Capital Resources': ['liquidity', 'capital resources', 'cash flow', 'financing', 'capital structure'],
      'Critical Accounting Policies': ['critical accounting', 'accounting policies', 'accounting estimates', 'estimates'],
      'Market Risk': ['market risk', 'interest rate risk', 'currency risk', 'foreign exchange risk'],
      'Contractual Obligations': ['contractual obligations', 'commitments', 'obligations'],
    };

    for (const [subsection, patterns] of Object.entries(subsectionPatterns)) {
      for (const pattern of patterns) {
        if (query.includes(pattern)) {
          this.logger.log(`🎯 Identified Item 7 subsection: ${subsection} (matched: "${pattern}")`);
          return subsection;
        }
      }
    }

    return undefined;
  }

  /**
   * Identify Item 8 (Financial Statements) subsections
   */
  private identifyItem8Subsection(query: string): string | undefined {
    // Check for specific note numbers first (most specific)
    const noteMatch = query.match(/\bnote\s+(\d+)\b/i);
    if (noteMatch) {
      const noteNumber = noteMatch[1];
      this.logger.log(`🎯 Identified Item 8 subsection: Note ${noteNumber}`);
      return `Note ${noteNumber}`;
    }

    // Subsection patterns for Item 8 (Financial Statements)
    const subsectionPatterns: Record<string, string[]> = {
      'Revenue Recognition': ['revenue recognition', 'revenue policy', 'recognize revenue'],
      'Leases': ['lease', 'leases', 'lease accounting', 'leasing'],
      'Stock-Based Compensation': ['stock-based compensation', 'equity compensation', 'stock compensation', 'share-based'],
      'Income Taxes': ['income tax', 'income taxes', 'tax provision', 'taxation'],
      'Debt': ['debt', 'borrowing', 'borrowings', 'credit facilities', 'credit facility'],
      'Fair Value': ['fair value', 'fair value measurement', 'fair value measurements'],
    };

    for (const [subsection, patterns] of Object.entries(subsectionPatterns)) {
      for (const pattern of patterns) {
        if (query.includes(pattern)) {
          this.logger.log(`🎯 Identified Item 8 subsection: ${subsection} (matched: "${pattern}")`);
          return subsection;
        }
      }
    }

    return undefined;
  }

  /**
   * Identify Item 1A (Risk Factors) subsections
   */
  private identifyItem1ASubsection(query: string): string | undefined {
    // Subsection patterns for Item 1A (Risk Factors)
    const subsectionPatterns: Record<string, string[]> = {
      'Operational Risks': ['operational risk', 'operational risks', 'operations risk'],
      'Financial Risks': ['financial risk', 'financial risks', 'credit risk'],
      'Market Risks': ['market risk', 'market risks', 'economic risk'],
      'Regulatory Risks': ['regulatory risk', 'regulatory risks', 'compliance risk', 'compliance'],
      'Technology Risks': ['technology risk', 'technology risks', 'cybersecurity', 'cyber security', 'data security'],
    };

    for (const [subsection, patterns] of Object.entries(subsectionPatterns)) {
      for (const pattern of patterns) {
        if (query.includes(pattern)) {
          this.logger.log(`🎯 Identified Item 1A subsection: ${subsection} (matched: "${pattern}")`);
          return subsection;
        }
      }
    }

    return undefined;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    ticker?: string | string[],
    metrics?: string[],
    period?: string,
  ): number {
    let confidence = 0.5; // Base confidence

    if (ticker) confidence += 0.2;
    if (metrics && metrics.length > 0) confidence += 0.2;
    if (period) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Detect intent using LLM (Claude 3.5 Haiku)
   */
  private async detectWithLLM(query: string): Promise<QueryIntent> {
    const prompt = `Extract structured intent from this financial query:
Query: "${query}"

Return ONLY valid JSON with these fields:
{
  "ticker": "string or array of ticker symbols (e.g., 'AAPL' or ['AAPL', 'MSFT'])",
  "metrics": ["array of metric names like 'Revenue', 'Net_Income'"],
  "sectionTypes": ["array of section types: 'item_1', 'item_7', 'item_8', 'item_1a'"],
  "subsectionName": "specific subsection if mentioned (e.g., 'Competition', 'Revenue Recognition')",
  "period": "time period like 'FY2024', 'Q4-2024', or 'latest'",
  "confidence": 0.0 to 1.0
}

Examples:
"Who are NVDA's competitors?" → {"ticker":"NVDA","sectionTypes":["item_1"],"subsectionName":"Competition","confidence":0.9}
"What is AAPL's revenue recognition policy?" → {"ticker":"AAPL","sectionTypes":["item_8"],"subsectionName":"Revenue Recognition","confidence":0.85}
"Compare MSFT and GOOGL revenue in 2024" → {"ticker":["MSFT","GOOGL"],"metrics":["Revenue"],"period":"FY2024","confidence":0.9}

Return ONLY the JSON object, no other text.`;

    try {
      const response = await this.bedrock.invokeClaude({
        prompt,
        modelId: 'us.anthropic.claude-3-5-haiku-20241022-v1:0', // Claude 3.5 Haiku Inference Profile
        max_tokens: 500,
      });

      // Parse LLM response
      const parsed = this.parseLLMResponse(response, query);
      return parsed;
    } catch (error) {
      this.logger.error(`LLM invocation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse LLM JSON response into QueryIntent
   */
  private parseLLMResponse(response: string, originalQuery: string): QueryIntent {
    try {
      // Extract JSON from response (LLM might add extra text)
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Build QueryIntent from parsed data
      const intent: QueryIntent = {
        type: this.determineQueryTypeFromLLM(parsed),
        ticker: parsed.ticker,
        metrics: parsed.metrics && parsed.metrics.length > 0 ? parsed.metrics : undefined,
        period: parsed.period,
        periodType: this.determinePeriodType(parsed.period),
        documentTypes: this.extractDocumentTypes(originalQuery),
        sectionTypes: parsed.sectionTypes && parsed.sectionTypes.length > 0 ? parsed.sectionTypes : undefined,
        subsectionName: parsed.subsectionName,
        needsNarrative: this.needsNarrative(originalQuery, this.determineQueryTypeFromLLM(parsed)),
        needsComparison: this.needsComparison(originalQuery),
        needsComputation: this.needsComputation(originalQuery, parsed.metrics || []),
        needsTrend: this.needsTrend(originalQuery),
        confidence: parsed.confidence || 0.8,
        originalQuery,
      };

      return intent;
    } catch (error) {
      this.logger.error(`Failed to parse LLM response: ${error.message}`);
      // Return low confidence intent
      return {
        type: 'semantic',
        confidence: 0.3,
        originalQuery,
        needsNarrative: true,
        needsComparison: false,
        needsComputation: false,
        needsTrend: false,
      };
    }
  }

  /**
   * Determine query type from LLM parsed data
   */
  private determineQueryTypeFromLLM(parsed: any): QueryType {
    const hasMetrics = parsed.metrics && parsed.metrics.length > 0;
    const hasSections = parsed.sectionTypes && parsed.sectionTypes.length > 0;

    if (hasMetrics && !hasSections) return 'structured';
    if (!hasMetrics && hasSections) return 'semantic';
    if (hasMetrics && hasSections) return 'hybrid';
    return 'semantic';
  }

  /**
   * Generic fallback detection that preserves regex-detected values
   * CRITICAL: This ensures ticker is not lost when LLM fallback fails
   */
  private detectGenericWithRegexFallback(query: string, regexIntent: QueryIntent): QueryIntent {
    this.logger.log(`🔧 Using generic fallback with regex-preserved ticker: ${regexIntent.ticker}`);
    
    return {
      type: regexIntent.type || 'semantic',
      ticker: regexIntent.ticker, // CRITICAL: Preserve the regex-detected ticker
      metrics: regexIntent.metrics,
      period: regexIntent.period,
      periodType: regexIntent.periodType,
      documentTypes: regexIntent.documentTypes,
      sectionTypes: regexIntent.sectionTypes,
      subsectionName: regexIntent.subsectionName,
      confidence: 0.5, // Slightly higher than pure generic since we have regex data
      originalQuery: query,
      needsNarrative: regexIntent.needsNarrative,
      needsComparison: regexIntent.needsComparison,
      needsComputation: regexIntent.needsComputation,
      needsTrend: regexIntent.needsTrend,
    };
  }

  /**
   * Calculate LLM cost for a query
   * Claude 3.5 Haiku: $0.25 per 1M input tokens, $1.25 per 1M output tokens
   */
  private calculateLLMCost(query: string): number {
    // Rough estimation: ~4 chars per token
    const inputTokens = (query.length + 500) / 4; // query + prompt
    const outputTokens = 150; // typical JSON response

    const inputCost = (inputTokens / 1_000_000) * 0.25;
    const outputCost = (outputTokens / 1_000_000) * 1.25;

    return inputCost + outputCost;
  }

  /**
   * Log usage statistics
   */
  private logUsageStats(): void {
    const total = this.llmUsageStats.totalQueries;
    if (total % 100 === 0) { // Log every 100 queries
      const regexRate = (this.llmUsageStats.regexSuccess / total) * 100;
      const llmRate = (this.llmUsageStats.llmFallback / total) * 100;
      const genericRate = (this.llmUsageStats.genericFallback / total) * 100;
      const avgLlmLatency = this.llmUsageStats.llmLatencyMs.length > 0
        ? this.llmUsageStats.llmLatencyMs.reduce((a, b) => a + b, 0) / this.llmUsageStats.llmLatencyMs.length
        : 0;

      this.logger.log(`📊 Intent Detection Stats (${total} queries):`);
      this.logger.log(`  - Regex success: ${regexRate.toFixed(1)}%`);
      this.logger.log(`  - LLM fallback: ${llmRate.toFixed(1)}%`);
      this.logger.log(`  - Generic fallback: ${genericRate.toFixed(1)}%`);
      this.logger.log(`  - Avg LLM latency: ${avgLlmLatency.toFixed(0)}ms`);
    }
  }
}
