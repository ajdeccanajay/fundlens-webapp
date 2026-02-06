# Design Document: RAG Robustness Enhancement

## Overview

This design enhances the RAG (Retrieval-Augmented Generation) system to achieve institutional-grade robustness for equity analysts. The system currently combines structured retrieval (PostgreSQL), semantic retrieval (AWS Bedrock Knowledge Base), and advanced retrieval techniques (HyDE, Query Decomposition, Contextual Expansion, Iterative Retrieval) with Claude Opus 4.5 for response generation.

The enhancement focuses on six key areas:
1. **Intent Detection Robustness** - Handle ambiguous queries, typos, and missing context
2. **Multi-Company Comparison** - Proper data normalization and side-by-side analysis
3. **Time-Series Analysis** - Historical trends, inflection points, and growth calculations
4. **Edge Case Handling** - Graceful degradation for invalid inputs
5. **Response Quality** - Confidence scoring, citations, and transparency
6. **Performance Optimization** - Sub-5-second latency and cost management

### Current Architecture

```
User Query
    ↓
Intent Detector (Regex → LLM → Generic)
    ↓
Query Router
    ↓
    ├─→ Structured Retriever (PostgreSQL)
    ├─→ Semantic Retriever (Bedrock KB + Advanced Techniques)
    └─→ Document RAG (User Documents)
    ↓
Response Generator (Claude Opus 4.5)
    ↓
RAG Response (Answer + Citations + Metrics)
```

### Design Principles

1. **Graceful Degradation** - System should provide useful responses even when data is incomplete
2. **Transparency** - Always indicate confidence levels and data sources
3. **Performance First** - Optimize for <5s latency while maintaining quality
4. **Cost Awareness** - Minimize LLM calls through intelligent caching and routing
5. **Institutional Grade** - Accuracy and reliability suitable for financial decision-making

## Architecture

### Component Overview

The RAG system consists of these key components:

1. **Intent Detector** (`intent-detector.service.ts`)
   - Three-tier detection: Regex → LLM → Generic
   - Extracts: ticker, metrics, period, sections, subsections
   - Current confidence threshold: 0.7 for regex, 0.6 for LLM

2. **Query Router** (`query-router.service.ts`)
   - Routes to structured, semantic, or hybrid retrieval
   - Builds execution plan based on intent

3. **Structured Retriever** (`structured-retriever.service.ts`)
   - PostgreSQL queries for exact metrics
   - Handles "latest", comparison, and time-series queries
   - Deduplication and quality filtering

4. **Semantic Retriever** (`semantic-retriever.service.ts`)
   - AWS Bedrock Knowledge Base vector search
   - PostgreSQL fallback for keyword search
   - Subsection filtering with fallback chain

5. **Advanced Retrieval** (`advanced-retrieval.service.ts`)
   - HyDE, Query Decomposition, Contextual Expansion
   - Iterative Retrieval, Reranking
   - Feature-flagged techniques

6. **Response Generator** (via `bedrock.service.ts`)
   - Claude Opus 4.5 for natural language generation
   - Combines metrics + narratives + user documents

## Components and Interfaces

### 1. Enhanced Intent Detector

**Purpose**: Improve intent detection robustness for ambiguous queries, typos, and missing context.

**Current Limitations**:
- Ticker typos not handled (e.g., "NVDIA" → "NVDA")
- Missing ticker context requires explicit mention
- Informal metric names not normalized (e.g., "sales" → "revenue")
- No confidence-based clarification requests

**Enhanced Design**:

```typescript
interface FuzzyMatchResult {
  original: string;
  matched: string;
  confidence: number;
  method: 'exact' | 'levenshtein' | 'phonetic';
}

interface IntentDetectorEnhancements {
  // Fuzzy matching for tickers
  fuzzyMatchTicker(input: string): FuzzyMatchResult | null;
  
  // Company name resolution
  resolveCompanyName(name: string): string | null;
  
  // Metric normalization
  normalizeMetricName(informal: string): string | null;
  
  // Context inference
  inferMissingContext(query: string, intent: QueryIntent): QueryIntent;
  
  // Clarification requests
  requestClarification(intent: QueryIntent): ClarificationRequest | null;
}

interface ClarificationRequest {
  reason: 'missing_ticker' | 'ambiguous_metric' | 'unclear_period';
  suggestions: string[];
  confidence: number;
}
```

**Fuzzy Matching Algorithm**:
- **Levenshtein Distance**: For typos (e.g., "NVDIA" → "NVDA", distance=2)
- **Phonetic Matching**: For sound-alike errors (e.g., "NVIDIA" → "NVDA")
- **Threshold**: Accept matches with distance ≤ 2 and confidence ≥ 0.8

**Company Name Resolution**:
```typescript
const COMPANY_NAME_MAP: Record<string, string> = {
  'nvidia': 'NVDA',
  'nvidia corporation': 'NVDA',
  'apple': 'AAPL',
  'apple inc': 'AAPL',
  'microsoft': 'MSFT',
  'microsoft corporation': 'MSFT',
  'amazon': 'AMZN',
  'amazon.com': 'AMZN',
  // ... comprehensive mapping
};
```

**Metric Normalization**:
```typescript
const METRIC_ALIASES: Record<string, string> = {
  'sales': 'Revenue',
  'top line': 'Revenue',
  'topline': 'Revenue',
  'profit': 'Net_Income',
  'earnings': 'Net_Income',
  'bottom line': 'Net_Income',
  'cogs': 'Cost_of_Revenue',
  'cost of goods sold': 'Cost_of_Revenue',
  // ... comprehensive aliases
};
```

**Implementation Strategy**:
1. Add fuzzy matching library (e.g., `fuzzball` or `fast-levenshtein`)
2. Extend `extractTicker()` with fuzzy matching fallback
3. Add `normalizeMetricName()` before metric extraction
4. Implement confidence-based clarification in `detectIntent()`

### 2. Multi-Company Comparison Engine

**Purpose**: Enable accurate side-by-side comparisons with proper data normalization.

**Current Limitations**:
- Multiple tickers handled but not optimized for comparison
- No fiscal year alignment for different fiscal year-ends
- No normalization for different reporting standards
- Results not formatted for easy comparison

**Enhanced Design**:

```typescript
interface ComparisonQuery {
  tickers: string[];
  metrics: string[];
  period?: string;
  normalizeByRevenue?: boolean;  // For size-adjusted comparison
  alignFiscalYears?: boolean;     // Align different FY ends
}

interface ComparisonResult {
  metric: string;
  companies: CompanyMetric[];
  analysis: {
    leader: string;
    laggard: string;
    spread: number;
    spreadPct: number;
  };
  normalization: {
    applied: boolean;
    method: 'none' | 'revenue' | 'assets';
    note: string;
  };
}

interface CompanyMetric {
  ticker: string;
  value: number;
  period: string;
  fiscalYearEnd: string;
  normalized: boolean;
  rank: number;
}
```

**Fiscal Year Alignment**:
```typescript
// Example: NVDA (Jan 31) vs MSFT (Jun 30)
// When comparing FY2024:
// - NVDA FY2024 = Feb 1, 2023 - Jan 31, 2024
// - MSFT FY2024 = Jul 1, 2023 - Jun 30, 2024
// 
// Alignment strategy:
// 1. Identify fiscal year-end for each company
// 2. Calculate overlap period
// 3. Note discrepancy in response
// 4. Optionally use quarterly data for better alignment
```

**Data Normalization**:
```typescript
function normalizeForComparison(
  metrics: MetricResult[],
  method: 'revenue' | 'assets'
): NormalizedMetric[] {
  // For each company:
  // 1. Get normalizing metric (revenue or total assets)
  // 2. Calculate ratio: metric / normalizing_metric
  // 3. Express as percentage or basis points
  // 4. Add normalization note to response
}
```

**Implementation Strategy**:
1. Add `ComparisonEngine` class in `structured-retriever.service.ts`
2. Implement fiscal year alignment logic
3. Add normalization methods (revenue-based, asset-based)
4. Enhance response formatting for side-by-side display
5. Add analysis (leader/laggard, spread calculation)

### 3. Time-Series and Trend Analyzer

**Purpose**: Analyze historical data, identify trends, and calculate growth rates.

**Current Limitations**:
- Time-series retrieval exists but no trend analysis
- No inflection point detection
- No volatility calculation
- Growth rates not automatically calculated

**Enhanced Design**:

```typescript
interface TimeSeriesQuery {
  ticker: string;
  metric: string;
  startPeriod?: string;
  endPeriod?: string;
  filingType?: '10-K' | '10-Q';
  includeGrowthRates?: boolean;
  detectInflections?: boolean;
}

interface TimeSeriesResult {
  ticker: string;
  metric: string;
  dataPoints: TimeSeriesPoint[];
  analysis: TrendAnalysis;
}

interface TimeSeriesPoint {
  period: string;
  value: number;
  filingDate: Date;
  yoyGrowth?: number;      // Year-over-year %
  qoqGrowth?: number;      // Quarter-over-quarter %
  isInflection?: boolean;  // Trend change point
}

interface TrendAnalysis {
  direction: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  avgGrowthRate: number;
  volatility: number;       // Standard deviation
  inflectionPoints: InflectionPoint[];
  summary: string;
}

interface InflectionPoint {
  period: string;
  type: 'acceleration' | 'deceleration' | 'reversal';
  magnitude: number;
  description: string;
}
```

**Trend Detection Algorithm**:
```typescript
function detectTrend(dataPoints: TimeSeriesPoint[]): TrendAnalysis {
  // 1. Calculate growth rates (YoY, QoQ)
  const growthRates = calculateGrowthRates(dataPoints);
  
  // 2. Identify inflection points
  // Inflection = significant change in growth rate
  // Threshold: >20% change in growth rate
  const inflections = detectInflections(growthRates, threshold=0.20);
  
  // 3. Calculate volatility (standard deviation of growth rates)
  const volatility = calculateStdDev(growthRates);
  
  // 4. Determine overall direction
  const direction = classifyTrend(growthRates, volatility);
  
  // 5. Generate summary
  const summary = generateTrendSummary(direction, inflections, volatility);
  
  return { direction, avgGrowthRate, volatility, inflectionPoints, summary };
}
```

**Inflection Point Detection**:
```typescript
function detectInflections(
  growthRates: number[],
  threshold: number
): InflectionPoint[] {
  const inflections: InflectionPoint[] = [];
  
  for (let i = 1; i < growthRates.length; i++) {
    const prev = growthRates[i - 1];
    const curr = growthRates[i];
    const change = curr - prev;
    const changePct = Math.abs(change / prev);
    
    if (changePct > threshold) {
      const type = classifyInflection(prev, curr);
      inflections.push({
        period: dataPoints[i].period,
        type,
        magnitude: changePct,
        description: describeInflection(type, changePct)
      });
    }
  }
  
  return inflections;
}

function classifyInflection(prev: number, curr: number): InflectionType {
  if (prev > 0 && curr > prev * 1.2) return 'acceleration';
  if (prev > 0 && curr < prev * 0.8) return 'deceleration';
  if (prev * curr < 0) return 'reversal';  // Sign change
  return 'acceleration';  // Default
}
```

**Implementation Strategy**:
1. Add `TrendAnalyzer` class in new file `trend-analyzer.service.ts`
2. Implement growth rate calculations (YoY, QoQ)
3. Add inflection point detection algorithm
4. Calculate volatility metrics
5. Integrate with `structured-retriever.service.ts`
6. Add trend visualization data for frontend

### 4. Edge Case Handler

**Purpose**: Handle invalid inputs, typos, and boundary conditions gracefully.

**Current Limitations**:
- Ticker typos cause query failure
- Invalid periods (e.g., "Q17 2024") not validated
- Empty queries not handled
- No input sanitization

**Enhanced Design**:

```typescript
interface EdgeCaseHandler {
  // Ticker validation and correction
  validateAndCorrectTicker(ticker: string): TickerValidation;
  
  // Period validation
  validatePeriod(period: string): PeriodValidation;
  
  // Query sanitization
  sanitizeQuery(query: string): string;
  
  // Length validation
  validateQueryLength(query: string): LengthValidation;
  
  // Rate limiting
  checkRateLimit(tenantId: string): RateLimitStatus;
}

interface TickerValidation {
  valid: boolean;
  original: string;
  corrected?: string;
  confidence: number;
  suggestions: string[];
}

interface PeriodValidation {
  valid: boolean;
  original: string;
  corrected?: string;
  suggestions: string[];
  error?: string;
}

interface LengthValidation {
  valid: boolean;
  length: number;
  maxLength: number;
  truncated?: string;
}
```

**Ticker Validation**:
```typescript
async function validateAndCorrectTicker(ticker: string): Promise<TickerValidation> {
  // 1. Check exact match in database
  const exists = await prisma.financialMetric.findFirst({
    where: { ticker: { equals: ticker, mode: 'insensitive' } }
  });
  
  if (exists) {
    return { valid: true, original: ticker, confidence: 1.0, suggestions: [] };
  }
  
  // 2. Try fuzzy matching
  const allTickers = await getAllTickers();
  const fuzzyMatch = findBestMatch(ticker, allTickers);
  
  if (fuzzyMatch.confidence >= 0.8) {
    return {
      valid: false,
      original: ticker,
      corrected: fuzzyMatch.matched,
      confidence: fuzzyMatch.confidence,
      suggestions: [fuzzyMatch.matched]
    };
  }
  
  // 3. Return suggestions
  const suggestions = findSimilarTickers(ticker, allTickers, limit=3);
  return {
    valid: false,
    original: ticker,
    confidence: 0,
    suggestions
  };
}
```

**Period Validation**:
```typescript
function validatePeriod(period: string): PeriodValidation {
  // Valid formats:
  // - "latest"
  // - "FY2024", "FY2023", etc.
  // - "Q1-2024", "Q2-2024", "Q3-2024", "Q4-2024"
  
  if (period === 'latest') {
    return { valid: true, original: period, suggestions: [] };
  }
  
  // Fiscal year pattern
  const fyMatch = period.match(/^FY(\d{4})$/i);
  if (fyMatch) {
    const year = parseInt(fyMatch[1]);
    if (year >= 2000 && year <= new Date().getFullYear() + 1) {
      return { valid: true, original: period, suggestions: [] };
    }
  }
  
  // Quarterly pattern
  const qMatch = period.match(/^Q([1-4])-(\d{4})$/i);
  if (qMatch) {
    const quarter = parseInt(qMatch[1]);
    const year = parseInt(qMatch[2]);
    if (quarter >= 1 && quarter <= 4 && year >= 2000 && year <= new Date().getFullYear() + 1) {
      return { valid: true, original: period, suggestions: [] };
    }
  }
  
  // Invalid - provide suggestions
  return {
    valid: false,
    original: period,
    error: 'Invalid period format',
    suggestions: ['latest', 'FY2024', 'Q4-2024', 'Q3-2024']
  };
}
```

**Query Sanitization**:
```typescript
function sanitizeQuery(query: string): string {
  // 1. Trim whitespace
  let sanitized = query.trim();
  
  // 2. Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');
  
  // 3. Remove special characters that could cause issues
  // Keep: letters, numbers, spaces, common punctuation
  sanitized = sanitized.replace(/[^\w\s\-.,?!()]/g, '');
  
  // 4. Handle encoding issues
  sanitized = sanitized.normalize('NFKC');
  
  return sanitized;
}
```

**Implementation Strategy**:
1. Add `EdgeCaseHandler` class in new file `edge-case-handler.service.ts`
2. Implement ticker validation with fuzzy matching
3. Add period validation with suggestions
4. Implement query sanitization
5. Add length validation (max 1000 chars)
6. Integrate with `intent-detector.service.ts`

### 5. Response Quality Enhancer

**Purpose**: Improve response quality with confidence scoring, citations, and transparency.

**Current Limitations**:
- No confidence scoring on responses
- Citations exist but not comprehensive
- No explanation of reasoning
- "No data found" not handled gracefully

**Enhanced Design**:

```typescript
interface EnhancedRAGResponse extends RAGResponse {
  confidence: ConfidenceScore;
  reasoning: ReasoningExplanation;
  dataQuality: DataQualityIndicators;
  alternatives?: AlternativeInterpretation[];
}

interface ConfidenceScore {
  overall: number;  // 0-1
  breakdown: {
    dataAvailability: number;
    retrievalQuality: number;
    generationQuality: number;
  };
  factors: string[];  // Factors affecting confidence
}

interface ReasoningExplanation {
  approach: string;  // How the query was processed
  dataSourcesUsed: string[];
  assumptions: string[];
  limitations: string[];
}

interface DataQualityIndicators {
  metricsQuality: {
    total: number;
    highConfidence: number;  // >0.9
    mediumConfidence: number;  // 0.7-0.9
    lowConfidence: number;  // <0.7
  };
  narrativesQuality: {
    total: number;
    avgRelevanceScore: number;
    sources: string[];
  };
  gaps: string[];  // Missing data points
}

interface AlternativeInterpretation {
  interpretation: string;
  confidence: number;
  reasoning: string;
}
```

**Confidence Calculation**:
```typescript
function calculateConfidence(
  intent: QueryIntent,
  metrics: MetricResult[],
  narratives: ChunkResult[]
): ConfidenceScore {
  // Data availability score (0-1)
  const dataAvailability = calculateDataAvailability(intent, metrics, narratives);
  
  // Retrieval quality score (0-1)
  const retrievalQuality = calculateRetrievalQuality(metrics, narratives);
  
  // Generation quality score (0-1)
  // Based on LLM usage and response coherence
  const generationQuality = 0.9;  // Placeholder - Claude Opus is high quality
  
  // Overall confidence (weighted average)
  const overall = (
    dataAvailability * 0.5 +
    retrievalQuality * 0.3 +
    generationQuality * 0.2
  );
  
  // Identify factors
  const factors = identifyConfidenceFactors(dataAvailability, retrievalQuality);
  
  return {
    overall,
    breakdown: { dataAvailability, retrievalQuality, generationQuality },
    factors
  };
}

function calculateDataAvailability(
  intent: QueryIntent,
  metrics: MetricResult[],
  narratives: ChunkResult[]
): number {
  let score = 0;
  
  // Check if requested metrics are available
  if (intent.metrics && intent.metrics.length > 0) {
    const foundMetrics = metrics.filter(m => 
      intent.metrics!.includes(m.normalizedMetric)
    );
    score += (foundMetrics.length / intent.metrics.length) * 0.5;
  } else {
    score += 0.5;  // No specific metrics requested
  }
  
  // Check if narrative sections are available
  if (intent.sectionTypes && intent.sectionTypes.length > 0) {
    const foundSections = new Set(narratives.map(n => n.metadata.sectionType));
    const requestedSections = new Set(intent.sectionTypes);
    const overlap = [...foundSections].filter(s => requestedSections.has(s));
    score += (overlap.length / intent.sectionTypes.length) * 0.5;
  } else {
    score += 0.5;  // No specific sections requested
  }
  
  return Math.min(score, 1.0);
}

function calculateRetrievalQuality(
  metrics: MetricResult[],
  narratives: ChunkResult[]
): number {
  let score = 0;
  
  // Metrics quality (based on confidence scores)
  if (metrics.length > 0) {
    const avgMetricConfidence = metrics.reduce((sum, m) => sum + m.confidenceScore, 0) / metrics.length;
    score += avgMetricConfidence * 0.5;
  } else {
    score += 0.5;  // No metrics requested
  }
  
  // Narratives quality (based on relevance scores)
  if (narratives.length > 0) {
    const avgNarrativeScore = narratives.reduce((sum, n) => sum + n.score, 0) / narratives.length;
    score += avgNarrativeScore * 0.5;
  } else {
    score += 0.5;  // No narratives requested
  }
  
  return Math.min(score, 1.0);
}
```

**Graceful "No Data Found" Handling**:
```typescript
function handleNoDataFound(intent: QueryIntent): EnhancedRAGResponse {
  const message = buildNoDataMessage(intent);
  const suggestions = generateSuggestions(intent);
  
  return {
    answer: message,
    intent,
    confidence: {
      overall: 0.1,
      breakdown: { dataAvailability: 0, retrievalQuality: 0, generationQuality: 1.0 },
      factors: ['No data available for requested query']
    },
    reasoning: {
      approach: 'No data found',
      dataSourcesUsed: [],
      assumptions: [],
      limitations: ['Requested data not available in database']
    },
    dataQuality: {
      metricsQuality: { total: 0, highConfidence: 0, mediumConfidence: 0, lowConfidence: 0 },
      narrativesQuality: { total: 0, avgRelevanceScore: 0, sources: [] },
      gaps: [buildGapDescription(intent)]
    },
    suggestions,
    timestamp: new Date(),
    latency: 0,
    cost: 0
  };
}

function buildNoDataMessage(intent: QueryIntent): string {
  const parts: string[] = [];
  
  parts.push("I couldn't find data for your query.");
  
  if (intent.ticker) {
    parts.push(`\n\nTicker: ${intent.ticker}`);
  }
  
  if (intent.metrics && intent.metrics.length > 0) {
    parts.push(`Metrics requested: ${intent.metrics.join(', ')}`);
  }
  
  if (intent.period) {
    parts.push(`Period: ${intent.period}`);
  }
  
  parts.push("\n\nPossible reasons:");
  parts.push("- Data not yet ingested for this company/period");
  parts.push("- Metric not available in SEC filings");
  parts.push("- Period outside available range");
  
  return parts.join('\n');
}
```

**Implementation Strategy**:
1. Add `ResponseQualityEnhancer` class in new file `response-quality.service.ts`
2. Implement confidence calculation
3. Add reasoning explanation generation
4. Implement data quality indicators
5. Add graceful "no data found" handling
6. Integrate with `rag.service.ts`

### 6. Performance Optimizer

**Purpose**: Achieve <5s latency for 90% of queries while managing costs.

**Current Performance**:
- Average latency: ~3-4s for hybrid queries
- LLM calls: ~1-2s (Claude Opus 4.5)
- Vector search: ~500-800ms (Bedrock KB)
- PostgreSQL: ~100-200ms

**Optimization Strategies**:

```typescript
interface PerformanceOptimizer {
  // Query result caching
  cacheQuery(query: string, response: RAGResponse, ttl: number): void;
  getCachedQuery(query: string): RAGResponse | null;
  
  // Parallel execution
  executeParallel<T>(tasks: Promise<T>[]): Promise<T[]>;
  
  // Smart LLM usage
  shouldUseLLM(intent: QueryIntent, metrics: any[], narratives: any[]): boolean;
  
  // Model tier selection
  selectModelTier(complexity: QueryComplexity): ModelTier;
  
  // Token budget management
  enforceTokenBudget(chunks: ChunkResult[], maxTokens: number): ChunkResult[];
}

type ModelTier = 'haiku' | 'sonnet' | 'opus';

interface QueryComplexity {
  level: 'simple' | 'medium' | 'complex';
  factors: string[];
  estimatedTokens: number;
}
```

**Caching Strategy**:
```typescript
// Cache key generation
function generateCacheKey(query: string, tenantId?: string): string {
  const normalized = query.toLowerCase().trim();
  return `rag:${tenantId || 'global'}:${hashString(normalized)}`;
}

// TTL based on query type
function getCacheTTL(intent: QueryIntent): number {
  // Latest queries: 1 hour (data changes frequently)
  if (intent.periodType === 'latest') {
    return 3600;
  }
  
  // Historical queries: 24 hours (data stable)
  if (intent.period && intent.period !== 'latest') {
    return 86400;
  }
  
  // Semantic queries: 6 hours (narrative stable)
  if (intent.type === 'semantic') {
    return 21600;
  }
  
  // Default: 1 hour
  return 3600;
}
```

**Parallel Execution**:
```typescript
async function executeHybridRetrieval(
  structuredQuery: StructuredQuery,
  semanticQuery: SemanticQuery
): Promise<{ metrics: any[], narratives: any[] }> {
  // Execute structured and semantic retrieval in parallel
  const [metricsResult, narrativesResult] = await Promise.all([
    structuredRetriever.retrieve(structuredQuery),
    semanticRetriever.retrieve(semanticQuery)
  ]);
  
  return {
    metrics: metricsResult.metrics,
    narratives: narrativesResult.narratives
  };
}
```

**Smart LLM Usage**:
```typescript
function shouldUseLLM(
  intent: QueryIntent,
  metrics: any[],
  narratives: any[]
): boolean {
  // Don't use LLM for simple metric lookups
  if (intent.type === 'structured' && metrics.length > 0 && !intent.needsNarrative) {
    return false;
  }
  
  // Don't use LLM if no data found
  if (metrics.length === 0 && narratives.length === 0) {
    return false;
  }
  
  // Use LLM for hybrid and semantic queries
  if (intent.type === 'hybrid' || intent.type === 'semantic') {
    return true;
  }
  
  // Use LLM if narrative explanation needed
  if (intent.needsNarrative) {
    return true;
  }
  
  return false;
}
```

**Model Tier Selection**:
```typescript
function selectModelTier(intent: QueryIntent): ModelTier {
  // Opus for complex analysis
  if (intent.needsComparison || intent.needsComputation || intent.needsTrend) {
    return 'opus';
  }
  
  // Sonnet for hybrid queries
  if (intent.type === 'hybrid') {
    return 'sonnet';
  }
  
  // Haiku for simple semantic queries
  if (intent.type === 'semantic' && !intent.needsNarrative) {
    return 'haiku';
  }
  
  // Default to Sonnet (balanced)
  return 'sonnet';
}
```

**Token Budget Management**:
```typescript
function enforceTokenBudget(
  chunks: ChunkResult[],
  maxTokens: number
): ChunkResult[] {
  // Estimate tokens (rough: 4 chars per token)
  let totalTokens = 0;
  const selected: ChunkResult[] = [];
  
  // Sort by relevance score (descending)
  const sorted = [...chunks].sort((a, b) => b.score - a.score);
  
  for (const chunk of sorted) {
    const chunkTokens = Math.ceil(chunk.content.length / 4);
    
    if (totalTokens + chunkTokens <= maxTokens) {
      selected.push(chunk);
      totalTokens += chunkTokens;
    } else {
      break;
    }
  }
  
  return selected;
}
```

**Implementation Strategy**:
1. Add `PerformanceOptimizer` class in new file `performance-optimizer.service.ts`
2. Implement Redis caching for query results
3. Add parallel execution for hybrid retrieval
4. Implement smart LLM usage logic
5. Add model tier selection
6. Implement token budget enforcement
7. Add performance monitoring and alerting

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property Reflection

After analyzing all acceptance criteria, I identified several areas where properties can be consolidated:

**Consolidation Opportunities**:
1. Properties 1.1, 1.3, 1.4 all test hybrid query handling - can be combined into one comprehensive property
2. Properties 3.1, 3.2, 3.3, 3.4 all test multi-company comparison - can be combined
3. Properties 7.1, 7.2, 7.3, 7.4, 7.5 all test qualitative section retrieval - can be combined
4. Properties 9.1, 9.2, 9.3, 9.5 all test performance - can be combined into latency property
5. Properties 11.1, 11.2, 11.3 all test intent detection fallback chain - can be combined
6. Properties 12.1, 12.2, 12.3, 12.4, 12.5 all test error handling - can be combined

**Unique Properties to Keep**:
- Computation properties (1.2, 6.1-6.4) - each tests different formula
- Ambiguity handling (2.1-2.5) - each tests different ambiguity type
- Time-series analysis (4.1-4.5) - each tests different aspect
- Edge cases (5.1, 5.2, 5.5) - each tests different edge case
- Advanced retrieval (10.1-10.5) - each tests different technique
- Accounting analysis (8.1-8.3, 8.5) - each tests different accounting topic

### Correctness Properties

Property 1: Hybrid Query Data Retrieval
*For any* hybrid query requesting both metrics and narrative, the system should retrieve structured data from PostgreSQL AND semantic content from Bedrock Knowledge Base, merge results with proper attribution, and include citations for all data sources.
**Validates: Requirements 1.1, 1.3, 1.4**

Property 2: Derived Metric Computation
*For any* query requesting computed metrics (margins, ratios, growth rates), the system should calculate derived metrics from base metrics using correct formulas (e.g., gross_margin = (Revenue - Cost_of_Revenue) / Revenue * 100).
**Validates: Requirements 1.2**

Property 3: Performance Latency Target
*For any* set of 100 queries, the p95 latency should be under 5000ms, with performance warnings logged for queries exceeding this threshold.
**Validates: Requirements 1.5, 9.1, 9.5**

Property 4: Ambiguous Query Handling
*For any* query with missing ticker context, incomplete syntax, or implied information, the system should either infer intent using LLM fallback OR provide a best-effort answer with confidence indicators below 0.7.
**Validates: Requirements 2.1, 2.2, 2.5**

Property 5: Section Inference for Qualitative Queries
*For any* query containing segment terms (e.g., "GPU business"), qualitative judgment terms (e.g., "conservative"), or strategic terms, the system should retrieve appropriate sections (Item 1 for business, Item 7/8 for accounting, Item 1A for risks).
**Validates: Requirements 2.3, 2.4**

Property 6: Multi-Company Comparison
*For any* query mentioning multiple tickers, the system should extract all tickers as an array, normalize data for same fiscal periods, retrieve comparable sections from each company, present data side-by-side with clear attribution, and explicitly indicate any data gaps.
**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

Property 7: Time-Series Retrieval and Analysis
*For any* query requesting historical data, the system should retrieve metrics across multiple fiscal periods, compute growth rates and changes, calculate volatility (standard deviation), identify inflection points (>20% change in growth rate), format results chronologically, and include MD&A narrative context.
**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**

Property 8: Ticker Fuzzy Matching
*For any* ticker with typos (Levenshtein distance ≤ 2), the system should attempt fuzzy matching and either correct the ticker with confidence ≥ 0.8 OR return a helpful error with suggestions.
**Validates: Requirements 5.1**

Property 9: Period Validation
*For any* query with an invalid period (e.g., "Q17 2024", year < 2000, year > current+1), the system should validate the period and return a clear error message with valid format suggestions.
**Validates: Requirements 5.2**

Property 10: Noise Filtering
*For any* query containing irrelevant text mixed with financial terms, the system should filter noise and extract financial intent with confidence ≥ 0.5.
**Validates: Requirements 5.5**

Property 11: ROIC Calculation
*For any* query requesting ROIC, the system should retrieve Net_Income, Total_Assets, Total_Liabilities and compute ROIC = Net_Income / (Total_Assets - Total_Liabilities) with formula attribution.
**Validates: Requirements 6.1**

Property 12: Free Cash Flow Calculation
*For any* query requesting FCF, the system should retrieve Operating_Cash_Flow and Capital_Expenditures and compute FCF = Operating_Cash_Flow - Capital_Expenditures.
**Validates: Requirements 6.2**

Property 13: Leverage Ratio Calculation
*For any* query requesting capital structure analysis, the system should retrieve Total_Liabilities and Total_Equity and compute debt-to-equity ratio = Total_Liabilities / Total_Equity.
**Validates: Requirements 6.3**

Property 14: Asset Efficiency Calculation
*For any* query requesting asset efficiency, the system should calculate asset turnover = Revenue / Total_Assets and working capital metrics.
**Validates: Requirements 6.4**

Property 15: Financial Analysis with Narrative Context
*For any* deep financial analysis query, the system should include both computed metrics AND narrative context from MD&A explaining drivers.
**Validates: Requirements 6.5**

Property 16: Qualitative Section Retrieval
*For any* qualitative query about competitive advantages, risks, market opportunity, or human capital, the system should retrieve appropriate sections (Item 1 for business/competition, Item 1A for risks, Item 7 for strategy) and provide relevant excerpts with source citations.
**Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5**

Property 17: Accounting Policy Multi-Section Retrieval
*For any* query about revenue recognition, accounting estimates, or inventory accounting, the system should retrieve BOTH Item 7 (Critical Accounting Policies) AND Item 8 (Financial Statement Notes) with specific policy text and section references.
**Validates: Requirements 8.1, 8.2, 8.3, 8.5**

Property 18: Model Selection Optimization
*For any* query, the system should use Claude 3.5 Haiku for intent detection (fast) and Claude Opus 4.5 for response generation (accurate), with technique selection optimized for speed.
**Validates: Requirements 9.2, 9.4**

Property 19: Reranking Latency Budget
*For any* query when Reranker is enabled, reranking should be limited to top N candidates such that reranking latency does not exceed 1000ms.
**Validates: Requirements 9.3**

Property 20: Query Decomposition for Complex Queries
*For any* complex query (multiple metrics + multiple sections + comparison), the Advanced_Retrieval should use Query Decomposition to break into sub-queries.
**Validates: Requirements 10.1**

Property 21: HyDE for Low Confidence Retrieval
*For any* initial retrieval with average relevance score < 0.7, the Advanced_Retrieval should use HyDE (Hypothetical Document Embeddings) to improve results.
**Validates: Requirements 10.2**

Property 22: Contextual Expansion for Insufficient Context
*For any* retrieval where top chunks are < 500 tokens total, the Advanced_Retrieval should use Contextual Expansion to include adjacent chunks up to 2000 tokens.
**Validates: Requirements 10.3**

Property 23: Iterative Retrieval for Insufficient Results
*For any* retrieval returning < 3 chunks, the Advanced_Retrieval should use Iterative Retrieval for follow-up queries.
**Validates: Requirements 10.4**

Property 24: Reranking Integration
*For any* query when Reranker is enabled, the Advanced_Retrieval should re-score chunks using Cohere Rerank 3.5 and reorder by relevance.
**Validates: Requirements 10.5**

Property 25: Intent Detection Fallback Chain
*For any* query, the Intent_Detector should attempt regex detection first (target confidence ≥ 0.7), fallback to LLM if regex confidence < 0.7, and use generic fallback preserving regex-detected values if LLM confidence < 0.6.
**Validates: Requirements 11.1, 11.2, 11.3**

Property 26: Multi-Ticker Array Format
*For any* query mentioning multiple tickers, the Intent_Detector should return tickers as an array (not string) for comparison queries.
**Validates: Requirements 11.4**

Property 27: Intent Analytics Logging
*For any* query, the Intent_Detector should log detection method, confidence, latency, and success status to analytics.
**Validates: Requirements 11.5**

Property 28: Specific Error Messages
*For any* query that fails validation, the system should return a specific error message indicating what failed (not generic "error occurred").
**Validates: Requirements 12.1**

Property 29: Helpful Not Found Messages
*For any* query where data is not found, the system should indicate what was searched (ticker, metrics, period) and suggest alternatives.
**Validates: Requirements 12.2**

Property 30: LLM Generation Fallback
*For any* query where LLM generation fails, the system should fallback to structured answer from retrieved data without crashing.
**Validates: Requirements 12.3**

Property 31: Error Logging with Details
*For any* error during retrieval or generation, the system should log error details (error type, message, stack trace) for debugging.
**Validates: Requirements 12.4**

Property 32: System Stability Under Errors
*For any* error condition, the system should maintain stability and return a valid response (even if error response) without crashing.
**Validates: Requirements 12.5**

Property 33: Test Suite Stability
*For any* run of the enterprise test suite (40+ test cases), the system should process all test cases without crashing or hanging.
**Validates: Requirements 13.1**

Property 34: Query Metrics Logging
*For any* query, the system should log detailed metrics including latency, confidence, techniques used, data sources, and costs.
**Validates: Requirements 14.1**

## Error Handling

### Error Categories

1. **Validation Errors** (4xx-level)
   - Empty query
   - Invalid ticker format
   - Invalid period format
   - Query too long (>1000 chars)
   - Missing required parameters

2. **Data Not Found Errors** (404-level)
   - Ticker not in database
   - Metrics not available for period
   - Sections not found in filings
   - No data for comparison

3. **System Errors** (5xx-level)
   - Database connection failure
   - Bedrock KB unavailable
   - LLM generation timeout
   - Out of memory

4. **Performance Errors**
   - Query timeout (>30s)
   - Rate limit exceeded
   - Token budget exceeded

### Error Handling Strategy

```typescript
interface ErrorResponse {
  error: {
    type: ErrorType;
    message: string;
    details?: any;
    suggestions?: string[];
    retryable: boolean;
  };
  query: string;
  timestamp: Date;
}

type ErrorType = 
  | 'validation_error'
  | 'not_found'
  | 'system_error'
  | 'timeout'
  | 'rate_limit';
```

**Validation Error Example**:
```typescript
{
  error: {
    type: 'validation_error',
    message: 'Invalid period format: "Q17 2024"',
    details: {
      provided: 'Q17 2024',
      validFormats: ['latest', 'FY2024', 'Q1-2024', 'Q2-2024', 'Q3-2024', 'Q4-2024']
    },
    suggestions: ['Did you mean "Q1-2024"?', 'Try "latest" for most recent data'],
    retryable: true
  },
  query: 'What is NVDA revenue in Q17 2024?',
  timestamp: '2024-02-04T10:30:00Z'
}
```

**Not Found Error Example**:
```typescript
{
  error: {
    type: 'not_found',
    message: 'No data found for NVDA in FY2025',
    details: {
      ticker: 'NVDA',
      period: 'FY2025',
      availablePeriods: ['FY2024', 'FY2023', 'FY2022'],
      searchedSources: ['PostgreSQL metrics', 'Bedrock KB narratives']
    },
    suggestions: [
      'Try "FY2024" for most recent data',
      'Use "latest" to get most recent available period'
    ],
    retryable: false
  },
  query: 'What is NVDA revenue in FY2025?',
  timestamp: '2024-02-04T10:30:00Z'
}
```

**System Error Example**:
```typescript
{
  error: {
    type: 'system_error',
    message: 'LLM generation failed',
    details: {
      service: 'BedrockService',
      operation: 'generate',
      errorCode: 'ThrottlingException',
      fallbackUsed: true
    },
    suggestions: ['Response generated from structured data only'],
    retryable: true
  },
  query: 'Explain NVDA gross margin expansion',
  timestamp: '2024-02-04T10:30:00Z'
}
```

### Graceful Degradation

The system should degrade gracefully when components fail:

1. **LLM Generation Fails** → Return structured answer from retrieved data
2. **Bedrock KB Unavailable** → Use PostgreSQL keyword search fallback
3. **Advanced Retrieval Fails** → Use standard retrieval
4. **Reranking Fails** → Use original relevance scores
5. **Intent Detection Fails** → Use generic semantic search

## Testing Strategy

### Dual Testing Approach

The system requires both unit tests and property-based tests:

**Unit Tests**:
- Specific examples demonstrating correct behavior
- Edge cases (empty query, invalid ticker, etc.)
- Error conditions (database failure, LLM timeout)
- Integration points between components

**Property-Based Tests**:
- Universal properties across all inputs
- Comprehensive input coverage through randomization
- Minimum 100 iterations per property test
- Each test references design document property

### Property Test Configuration

**Library**: Use `fast-check` for TypeScript property-based testing

**Configuration**:
```typescript
import * as fc from 'fast-check';

// Example property test
describe('Property 1: Hybrid Query Data Retrieval', () => {
  it('should retrieve both metrics and narratives for hybrid queries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          ticker: fc.constantFrom('NVDA', 'AAPL', 'MSFT', 'AMZN'),
          metric: fc.constantFrom('Revenue', 'Net_Income', 'Gross_Profit'),
          narrative: fc.constantFrom('explain', 'why', 'how', 'describe')
        }),
        async ({ ticker, metric, narrative }) => {
          const query = `${narrative} ${ticker} ${metric}`;
          const response = await ragService.query(query);
          
          // Property: Hybrid queries should return both metrics and narratives
          expect(response.metrics).toBeDefined();
          expect(response.metrics!.length).toBeGreaterThan(0);
          expect(response.narratives).toBeDefined();
          expect(response.narratives!.length).toBeGreaterThan(0);
          
          // Property: All data should have citations
          expect(response.sources).toBeDefined();
          expect(response.sources!.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }  // Minimum 100 iterations
    );
  });
});
```

**Test Tags**:
Each property test must include a comment tag:
```typescript
/**
 * Feature: rag-robustness-enhancement
 * Property 1: Hybrid Query Data Retrieval
 * Validates: Requirements 1.1, 1.3, 1.4
 */
```

### Enterprise Test Suite Integration

The existing enterprise test suite (`scripts/test-enterprise-grade-rag.js`) serves as the acceptance test:

**Test Categories** (8 suites, 40+ tests):
1. Hybrid Complex Queries (3 tests)
2. Ambiguous & Contextual Queries (4 tests)
3. Multi-Company Comparative Analysis (3 tests)
4. Time-Series & Trend Analysis (3 tests)
5. Edge Cases & Robustness (5 tests)
6. Deep Financial Analysis (4 tests)
7. Qualitative Deep Dives (4 tests)
8. Accounting & Policy Analysis (3 tests)

**Scoring Criteria**:
- Response exists (20 points)
- Intent detection accuracy (20 points)
- Data retrieval (30 points)
- Performance <5s (15 points)
- Answer quality (15 points)

**Target**: 80%+ overall score (Grade B or better)

**Iterative Improvement Process**:
1. Run test suite and identify failing tests
2. Analyze failure patterns (intent detection, retrieval, performance)
3. Implement targeted fixes for highest-impact issues
4. Re-run test suite and measure improvement
5. Repeat until 80%+ score achieved
6. Document final configuration and techniques

### Test Execution

**Unit Tests**:
```bash
npm test -- rag-robustness
```

**Property Tests**:
```bash
npm test -- rag-robustness.properties
```

**Enterprise Test Suite**:
```bash
node scripts/test-enterprise-grade-rag.js
```

**Performance Benchmarking**:
```bash
npm run benchmark:rag
```

### Success Criteria

The system is considered production-ready when:
1. ✅ Enterprise test suite score ≥ 80% (Grade B)
2. ✅ All property tests pass (100 iterations each)
3. ✅ P95 latency < 5 seconds
4. ✅ No crashes or hangs in test suite
5. ✅ Error messages are specific and helpful
6. ✅ All edge cases handled gracefully
