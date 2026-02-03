import { Injectable, Logger } from '@nestjs/common';
import { QueryIntent, QueryType, PeriodType } from './types/query-intent';

/**
 * Intent Detector Service
 * Parses natural language queries to extract structured intent
 * 
 * Uses pattern matching and keyword detection for now
 * Can be enhanced with LLM-based parsing later
 */
@Injectable()
export class IntentDetectorService {
  private readonly logger = new Logger(IntentDetectorService.name);

  /**
   * Detect intent from natural language query
   */
  async detectIntent(query: string): Promise<QueryIntent> {
    this.logger.log(`Detecting intent for query: "${query}"`);

    const normalizedQuery = query.toLowerCase();

    // Extract components
    const ticker = this.extractTicker(normalizedQuery);
    const metrics = this.extractMetrics(normalizedQuery);
    const period = this.extractPeriod(normalizedQuery);
    const periodType = this.determinePeriodType(period);
    const documentTypes = this.extractDocumentTypes(normalizedQuery);
    const sectionTypes = this.extractSectionTypes(normalizedQuery);

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
    if (query.match(/\b(business|business model|strategy|what does.*do|describe.*company|products|services)\b/i)) {
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
}
